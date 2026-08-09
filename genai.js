/* ============================================================
   genai.js — the Gen AI bench (dev mode only).

   Two tools sit behind the dev gate here, and they are behind it for
   different reasons. Read this before assuming the page is finished.

   Video → image is real and complete. A <video> element decodes with the
   browser's own codecs, a seek plus drawImage yields the frame, and
   canvas.toBlob encodes it. No model, no library, no upload.

   Image → HTML is deliberately partial, and the page says so in print.
   Turning a screenshot into markup means inferring layout, and that needs
   a vision model this site does not ship — the whole premise here is that
   nothing is uploaded and no third-party runtime is loaded. What this
   half does instead is the part that is honestly computable in a tab:
   real dimensions, a sampled colour palette, and a scaffold that embeds
   the image with those values filled in. It does not pretend to have read
   the design, and the generated file carries a comment saying so.

   The alternative was a control that looked like the hosted product and
   produced fabricated markup. That is worse than an unfinished tool.
   ============================================================ */

/* @pure-start — free of DOM, storage and network. Loaded directly by
   test/genai.test.js. */

/* ============ LIMITS ============
   Frames are decoded and encoded on the main thread, so both caps exist
   to stop the tab locking rather than to be conservative for its own
   sake. */
const GENAI_LIMITS = {
  maxFrames: 12,
  maxPixels: 40000000,
  seekTimeoutMs: 8000,
  paletteColours: 6,
  paletteStep: 32,        // quantisation bucket per channel
  sampleStride: 4,        // every 4th pixel; a palette does not need all of them
};

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ============ FRAME TIMES ============
   Evenly spaced and inset from both ends. Grabbing at exactly 0 and
   exactly `duration` is how you get a black first frame and a failed
   seek on the last one: many containers have nothing decodable at the
   final timestamp. */
function evenlySpacedTimes(duration, count) {
  const total = Number(duration);
  const wanted = Math.max(1, Math.min(GENAI_LIMITS.maxFrames, Math.floor(Number(count) || 1)));
  if (!Number.isFinite(total) || total <= 0) return [];
  if (wanted === 1) return [total / 2];

  const step = total / (wanted + 1);
  return Array.from({ length: wanted }, (_, i) => Number((step * (i + 1)).toFixed(3)));
}

function formatDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) return '—';
  const whole = Math.floor(total);
  const hours = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = n => String(n).padStart(2, '0');
  const fraction = String(Math.round((total - whole) * 100)).padStart(2, '0');
  return `${hours ? `${hours}:${pad(mins)}` : mins}:${pad(secs)}.${fraction}`;
}

/* A filename that sorts. Seconds with the decimal point replaced, zero
   padded, so ten frames from one video list in the order they were shot
   rather than 1, 10, 2. */
function frameFilename(source, seconds, ext) {
  const stem = String(source == null ? 'frame' : source).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'frame';
  const time = Number(seconds);
  const stamp = Number.isFinite(time) ? time.toFixed(2).padStart(8, '0').replace('.', 's') : '00000s00';
  return `${stem}-${stamp}.${ext || 'png'}`;
}

/* ============ PALETTE ============
   Buckets each channel, counts the buckets, returns the busiest. Not a
   median cut and not k-means: this is a palette for a scaffold, and the
   cheap version is honest about being cheap.

   `pixels` is a flat RGBA array, the shape canvas getImageData hands
   back, so the real caller passes its buffer straight through. */
function quantiseChannel(value, step) {
  const size = step || GENAI_LIMITS.paletteStep;
  return Math.min(255, Math.round(value / size) * size);
}

function toHex(r, g, b) {
  return `#${[r, g, b].map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}`;
}

function topColours(pixels, count, options) {
  const settings = options || {};
  const step = settings.step || GENAI_LIMITS.paletteStep;
  const stride = Math.max(1, settings.stride || GENAI_LIMITS.sampleStride);
  const wanted = Math.max(1, Math.floor(Number(count) || GENAI_LIMITS.paletteColours));
  const buckets = new Map();

  for (let i = 0; i + 3 < pixels.length; i += 4 * stride) {
    /* A pixel that is mostly transparent is not part of the palette —
       without this, a logo on a transparent canvas comes back as six
       shades of black. */
    if (pixels[i + 3] < 128) continue;
    const r = quantiseChannel(pixels[i], step);
    const g = quantiseChannel(pixels[i + 1], step);
    const b = quantiseChannel(pixels[i + 2], step);
    const key = `${r},${g},${b}`;
    const held = buckets.get(key);
    if (held) held.count += 1;
    else buckets.set(key, { r, g, b, count: 1 });
  }

  return [...buckets.values()]
    /* Count first, then a stable tie-break on the colour itself, so the
       same image never produces two different palettes. */
    .sort((a, b) => b.count - a.count || toHex(a.r, a.g, a.b).localeCompare(toHex(b.r, b.g, b.b)))
    .slice(0, wanted)
    .map(entry => ({ hex: toHex(entry.r, entry.g, entry.b), count: entry.count }));
}

/* ============ SCAFFOLD ============
   Everything interpolated here comes from a file the visitor chose, so
   every one of it is escaped. The generated page is meant to be opened
   and edited, and the comment at the top is not decoration: without it
   this output would read as a finished conversion. */
function scaffoldHtml(spec) {
  const info = spec || {};
  const title = escapeHtml(info.title || 'Untitled');
  const width = Math.max(1, Math.round(Number(info.width) || 1));
  const height = Math.max(1, Math.round(Number(info.height) || 1));
  const palette = Array.isArray(info.palette) ? info.palette : [];
  const src = escapeHtml(info.src || '');
  const alt = escapeHtml(info.alt || 'Describe this image');

  const vars = palette.length
    ? palette.map((entry, i) => `      --colour-${i + 1}: ${escapeHtml(entry.hex)};`).join('\n')
    : '      --colour-1: #000000;';

  const swatches = palette.length
    ? palette.map((entry, i) => `      <li style="background: var(--colour-${i + 1})"><code>${escapeHtml(entry.hex)}</code></li>`).join('\n')
    : '      <li><code>no colours sampled</code></li>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <!--
    Scaffold generated from an image by The Hallucinated Lab.

    What is real below: the image itself, its true pixel dimensions, and
    the ${palette.length} most common colours sampled from it.

    What is NOT below: the layout. Nothing here has looked at the design
    and worked out that this is a header, that is a sidebar, those are
    three cards. That inference needs a vision model, and this ran
    entirely in a browser tab with no model and no upload. Treat this as
    a starting point with the measurements already filled in, not as a
    conversion of the design.
  -->
  <style>
    :root {
${vars}
    }
    body {
      margin: 0;
      font-family: system-ui, sans-serif;
      background: var(--colour-1);
      color: var(--colour-${Math.min(palette.length, 2) || 1});
    }
    .source { display: block; width: 100%; max-width: ${width}px; height: auto; }
    .palette { display: flex; gap: 8px; list-style: none; padding: 16px; margin: 0; flex-wrap: wrap; }
    .palette li { padding: 12px 16px; border-radius: 6px; font: 12px/1 ui-monospace, monospace; }
    .palette code { background: rgba(255, 255, 255, 0.85); color: #111; padding: 2px 4px; border-radius: 3px; }
  </style>
</head>
<body>

  <!-- The source image, at its real size: ${width} x ${height}. -->
  <img class="source" src="${src}" alt="${alt}" width="${width}" height="${height}">

  <!-- Sampled from the image, busiest first. -->
  <ul class="palette">
${swatches}
  </ul>

</body>
</html>
`;
}

/* @pure-end */

/* Published on the site's single THL namespace so the panels below and
   the tests reach the same functions. */
window.THL = window.THL || {};
window.THL.genai = {
  GENAI_LIMITS: GENAI_LIMITS,
  evenlySpacedTimes: evenlySpacedTimes,
  formatDuration: formatDuration,
  frameFilename: frameFilename,
  topColours: topColours,
  scaffoldHtml: scaffoldHtml,
  escapeHtml: escapeHtml,
};

/* ============ DOM HELPERS ============ */
function node(id) {
  return document.getElementById(id);
}

function say(target, message, isError) {
  if (!target) return;
  target.textContent = message || '';
  target.classList.toggle('is-error', Boolean(isError));
}

/* ============ VIDEO → IMAGE ============ */

/* A seek that never completes is the same failure as a fetch with no
   deadline: the UI waits forever with no way out. The listener is removed
   on both paths so a long strip does not accumulate one per frame. */
function seekTo(video, seconds) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const onSeeked = () => done(null);
    const onError = () => done(new Error('The browser failed while seeking this video.'));

    function done(err) {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      if (err) reject(err); else resolve();
    }

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    timer = setTimeout(() => done(new Error('That seek timed out — the browser may not be able to decode this file.')),
      window.THL.genai.GENAI_LIMITS.seekTimeoutMs);

    /* Clamped just inside the end: seeking to exactly `duration` never
       fires `seeked` in several containers. */
    video.currentTime = Math.max(0, Math.min(seconds, Math.max(0, video.duration - 0.05)));
  });
}

function frameBlob(video, mime) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('This browser could not encode the frame. Try PNG.'));
    }, mime, 0.92);
  });
}

function initVideoPanel() {
  const helpers = window.THL && window.THL.genai;
  const drop = node('vid-drop');
  const picker = node('vid-file');
  const video = node('vid-player');
  const status = node('vid-status');
  const meta = node('vid-meta');
  const controls = node('vid-controls');
  const scrub = node('vid-time');
  const timeLabel = node('vid-time-label');
  const countSelect = node('vid-count');
  const format = node('vid-format');
  const strip = node('vid-strip');
  if (!drop || !picker || !video || !helpers) return;

  let sourceName = 'video';
  let sourceUrl = null;
  const frameUrls = [];
  let working = false;

  const clearStrip = () => {
    while (frameUrls.length) URL.revokeObjectURL(frameUrls.pop());
    if (strip) strip.innerHTML = '';
  };

  const addFrame = (blob, seconds) => {
    if (!strip) return;
    const url = URL.createObjectURL(blob);
    frameUrls.push(url);
    const ext = (format ? format.value : 'image/png').split('/')[1].replace('jpeg', 'jpg');
    const item = document.createElement('li');
    item.className = 'frame-card';
    item.innerHTML = `
      <img src="${helpers.escapeHtml(url)}" alt="Frame at ${helpers.escapeHtml(helpers.formatDuration(seconds))}" width="240" height="135" loading="lazy" decoding="async">
      <div class="frame-card-foot">
        <span>${helpers.escapeHtml(helpers.formatDuration(seconds))}</span>
        <a class="ghost-btn frame-download" href="${helpers.escapeHtml(url)}" download="${helpers.escapeHtml(helpers.frameFilename(sourceName, seconds, ext))}">Save</a>
      </div>`;
    strip.appendChild(item);
  };

  const grab = async (times) => {
    if (working) return;
    if (!video.videoWidth) {
      say(status, 'Load a video first.', true);
      return;
    }
    working = true;
    clearStrip();
    const mime = format ? format.value : 'image/png';
    try {
      for (const seconds of times) {
        say(status, `Grabbing ${helpers.formatDuration(seconds)}…`);
        /* Sequential on purpose: one seek at a time is the only thing a
           <video> element can honour, so this loop cannot be parallelised
           however slow a long strip feels. */
        await seekTo(video, seconds);
        const blob = await frameBlob(video, mime);
        addFrame(blob, seconds);
      }
      say(status, `${times.length} frame${times.length === 1 ? '' : 's'} decoded in this tab. Nothing was uploaded.`);
    } catch (err) {
      say(status, err && err.message ? err.message : 'That frame could not be grabbed.', true);
    } finally {
      working = false;
    }
  };

  const load = (file) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      say(status, 'That is not a video file.', true);
      return;
    }
    clearStrip();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = URL.createObjectURL(file);
    sourceName = file.name || 'video';
    video.src = sourceUrl;
    say(status, 'Reading the file…');
  };

  video.addEventListener('loadedmetadata', () => {
    const pixels = video.videoWidth * video.videoHeight;
    if (!pixels) {
      say(status, 'This browser decoded no video track from that file. It may be audio only, or a codec this browser does not support.', true);
      return;
    }
    if (pixels > helpers.GENAI_LIMITS.maxPixels) {
      say(status, 'That video is over 40 megapixels a frame — encoding one on the main thread would lock the tab.', true);
      return;
    }
    if (controls) controls.hidden = false;
    if (scrub) {
      scrub.max = String(Math.max(0.1, video.duration || 0.1));
      scrub.value = String((video.duration || 1) / 2);
      if (timeLabel) timeLabel.textContent = helpers.formatDuration(scrub.value);
    }
    if (meta) {
      meta.textContent = `${video.videoWidth} × ${video.videoHeight}, ${helpers.formatDuration(video.duration)} long.`;
    }
    say(status, 'Ready. Pick a moment, or grab a strip.');
  });

  video.addEventListener('error', () => {
    if (controls) controls.hidden = true;
    say(status, 'This browser could not decode that video. Browsers ship different codecs — an MP4 (H.264) or WebM will usually work where a MOV or AV1 file does not.', true);
  });

  picker.addEventListener('change', () => load(picker.files && picker.files[0]));
  const pick = node('vid-pick');
  if (pick) pick.addEventListener('click', () => picker.click());

  ['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach(type => drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
  }));
  drop.addEventListener('drop', e => load(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]));

  if (scrub && timeLabel) {
    scrub.addEventListener('input', () => {
      timeLabel.textContent = helpers.formatDuration(scrub.value);
    });
  }

  const one = node('vid-grab-one');
  if (one) one.addEventListener('click', () => grab([Number(scrub ? scrub.value : 0)]));

  const many = node('vid-grab-many');
  if (many) {
    many.addEventListener('click', () => {
      const count = Number(countSelect ? countSelect.value : 6);
      const times = helpers.evenlySpacedTimes(video.duration, count);
      if (times.length === 0) {
        say(status, 'This video reports no duration, so a strip cannot be spaced across it. Grab a single frame instead.', true);
        return;
      }
      grab(times);
    });
  }
}

/* ============ IMAGE → HTML ============ */
function initImageHtmlPanel() {
  const helpers = window.THL && window.THL.genai;
  const drop = node('ih-drop');
  const picker = node('ih-file');
  const status = node('ih-status');
  const output = node('ih-output');
  const preview = node('ih-palette');
  if (!drop || !picker || !output || !helpers) return;

  let lastName = 'scaffold';

  const build = (image, file) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    let palette = [];
    try {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      palette = helpers.topColours(data, helpers.GENAI_LIMITS.paletteColours);
    } catch (err) {
      /* getImageData on a canvas holding a cross-origin image throws.
         A local file never is, but a data: URL pasted into the page
         could be, and the scaffold is still worth producing without a
         palette. */
      palette = [];
    }

    if (preview) {
      preview.innerHTML = palette.length
        ? palette.map(entry => `<li><span class="ih-swatch" style="background: ${helpers.escapeHtml(entry.hex)}"></span><code>${helpers.escapeHtml(entry.hex)}</code></li>`).join('')
        : '<li><code>no colours sampled</code></li>';
    }

    output.value = helpers.scaffoldHtml({
      title: (file && file.name ? file.name.replace(/\.[^.]+$/, '') : 'Untitled'),
      width: canvas.width,
      height: canvas.height,
      palette: palette,
      /* The image is embedded rather than linked, so the generated file
         is one self-contained thing the visitor can open. */
      src: canvas.toDataURL('image/png'),
      alt: 'Describe this image',
    });

    say(status, `${canvas.width} × ${canvas.height}, ${palette.length} colours sampled. The layout is not inferred — see the comment at the top of the output.`);
  };

  const load = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      say(status, 'That is not an image file.', true);
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.naturalWidth * image.naturalHeight > helpers.GENAI_LIMITS.maxPixels) {
        say(status, 'That image is over 40 megapixels — reading every pixel would lock the tab.', true);
        return;
      }
      lastName = (file.name || 'scaffold').replace(/\.[^.]+$/, '');
      build(image, file);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      say(status, 'This browser could not decode that image.', true);
    };
    image.src = url;
  };

  picker.addEventListener('change', () => load(picker.files && picker.files[0]));
  const pick = node('ih-pick');
  if (pick) pick.addEventListener('click', () => picker.click());

  ['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach(type => drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
  }));
  drop.addEventListener('drop', e => load(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]));

  const copy = node('ih-copy');
  if (copy) {
    copy.addEventListener('click', async () => {
      if (!output.value) {
        say(status, 'Load an image first.', true);
        return;
      }
      try {
        await navigator.clipboard.writeText(output.value);
        say(status, 'Scaffold copied to the clipboard.');
      } catch (err) {
        say(status, 'This browser would not let the page reach the clipboard — select the text and copy it.', true);
      }
    });
  }

  const download = node('ih-download');
  if (download) {
    download.addEventListener('click', () => {
      if (!output.value) {
        say(status, 'Load an image first.', true);
        return;
      }
      const url = URL.createObjectURL(new Blob([output.value], { type: 'text/html;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${lastName}-scaffold.html`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
}

/* ============ INIT ============ */
document.addEventListener('DOMContentLoaded', () => {
  [
    ['video', initVideoPanel],
    ['image-to-html', initImageHtmlPanel],
  ].forEach(([name, run]) => {
    try {
      run();
    } catch (err) {
      console.error(`[genai] ${name} failed:`, err);
    }
  });
});
