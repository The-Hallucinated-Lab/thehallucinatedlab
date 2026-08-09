/* ============================================================
   genai.test.js — the pure half of the Gen AI bench.

   The video panel cannot be tested here: decoding needs a real <video>
   element. What can be, and is, is everything that decides *what* to
   decode and what to write out — frame timing, filenames, palette
   sampling, and the scaffold's escaping.

   The scaffold matters most. Every value in it comes from a file the
   visitor chose, and the output is HTML they will open, so an unescaped
   filename there is a live injection in whatever renders it.
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPure, ROOT } = require('./helpers/load-pure');

const {
  GENAI_LIMITS, evenlySpacedTimes, formatDuration, frameFilename,
  topColours, scaffoldHtml, escapeHtml,
} = loadPure('genai.js', [
  'GENAI_LIMITS', 'evenlySpacedTimes', 'formatDuration', 'frameFilename',
  'topColours', 'scaffoldHtml', 'escapeHtml',
]);

/* A flat RGBA buffer, the shape canvas getImageData hands back. */
function pixels(colours) {
  const out = [];
  for (const [r, g, b, a, count] of colours) {
    for (let i = 0; i < (count || 1); i++) out.push(r, g, b, a === undefined ? 255 : a);
  }
  return out;
}

/* ============ FRAME TIMES ============ */

test('a strip is spaced evenly and inset from both ends', () => {
  /* Grabbing at exactly 0 and exactly `duration` is how you get a black
     first frame and a seek that never completes on the last one. */
  const times = evenlySpacedTimes(10, 4);
  assert.equal(times.length, 4);
  assert.ok(times[0] > 0, 'the first frame must not be at zero');
  assert.ok(times[times.length - 1] < 10, 'the last frame must not be at the duration');

  const gaps = times.slice(1).map((t, i) => Number((t - times[i]).toFixed(3)));
  assert.equal(new Set(gaps).size, 1, `gaps are uneven: ${gaps}`);
});

test('one frame is taken from the middle, not from the start', () => {
  assert.deepEqual(evenlySpacedTimes(10, 1), [5]);
});

test('the frame count is clamped to what the main thread can encode', () => {
  assert.equal(evenlySpacedTimes(60, 500).length, GENAI_LIMITS.maxFrames);
  assert.equal(evenlySpacedTimes(60, 0).length, 1);
  assert.equal(evenlySpacedTimes(60, -3).length, 1);
  assert.equal(evenlySpacedTimes(60, 2.7).length, 2, 'a fractional count truncates rather than throwing');
});

test('a video with no usable duration yields no strip rather than NaN times', () => {
  /* A stream, or a file whose metadata has not loaded, reports 0 or
     Infinity for duration. Either would otherwise produce NaN
     timestamps, and seeking to NaN hangs. */
  for (const duration of [0, -1, NaN, Infinity, undefined, null, 'abc']) {
    assert.deepEqual(evenlySpacedTimes(duration, 6), [], `accepted duration ${duration}`);
  }
});

test('every generated timestamp is a finite number inside the clip', () => {
  for (const duration of [0.5, 3, 97.3, 3600]) {
    for (const count of [1, 3, 6, 12]) {
      for (const t of evenlySpacedTimes(duration, count)) {
        assert.ok(Number.isFinite(t), `${duration}/${count} produced ${t}`);
        assert.ok(t > 0 && t < duration, `${t} is outside 0..${duration}`);
      }
    }
  }
});

/* ============ LABELS AND FILENAMES ============ */

test('durations read as times, not as decimals', () => {
  assert.equal(formatDuration(0), '0:00.00');
  assert.equal(formatDuration(9.5), '0:09.50');
  assert.equal(formatDuration(75), '1:15.00');
  assert.equal(formatDuration(3675), '1:01:15.00');
  assert.equal(formatDuration(-1), '—');
  assert.equal(formatDuration('abc'), '—');
  assert.equal(formatDuration(undefined), '—');
});

test('frame filenames sort in the order the frames were taken', () => {
  const names = [1.5, 2, 10, 100].map(t => frameFilename('clip.mp4', t, 'png'));
  assert.deepEqual([...names].sort(), names, `1, 10, 2 ordering: ${names}`);
  assert.match(names[0], /^clip-/);
  assert.match(names[0], /\.png$/);
});

test('a filename is built from the source name without inheriting its problems', () => {
  assert.match(frameFilename('My Holiday (final).mov', 1, 'jpg'), /^My-Holiday-final-.*\.jpg$/);
  /* The property that matters is not what survives but what cannot: a
     download filename carrying a path separator or a .. segment is how a
     save dialog gets pointed somewhere it was not meant to go. */
  for (const hostile of ['../../etc/passwd', 'a/b/c.png', 'C:\\Windows\\x.mp4', '..', '.']) {
    const name = frameFilename(hostile, 1, 'png');
    assert.doesNotMatch(name, /[/\\]/, `${hostile} left a separator in ${name}`);
    assert.doesNotMatch(name, /\.\./, `${hostile} left a .. in ${name}`);
    assert.match(name, /-\d+s\d+\.png$/, `${hostile} produced ${name}`);
  }
  assert.match(frameFilename('', 1, 'png'), /^frame-/);
  assert.match(frameFilename(null, 1, 'png'), /^frame-/);
  assert.match(frameFilename('clip.mp4', 'nonsense', 'png'), /^clip-00000s00\.png$/);
  assert.match(frameFilename('clip.mp4', 1), /\.png$/, 'the extension defaults rather than reading "undefined"');
});

/* ============ PALETTE ============ */

test('the busiest colours come back, busiest first', () => {
  const data = pixels([
    [255, 0, 0, 255, 100],
    [0, 255, 0, 255, 50],
    [0, 0, 255, 255, 10],
  ]);
  const palette = topColours(data, 3, { stride: 1 });
  assert.equal(palette.length, 3);
  assert.equal(palette[0].hex, '#ff0000');
  assert.equal(palette[1].hex, '#00ff00');
  assert.equal(palette[2].hex, '#0000ff');
  assert.ok(palette[0].count > palette[1].count);
});

test('near-identical colours collapse into one entry', () => {
  /* Without quantisation, a photograph returns six imperceptibly
     different greys and the palette is useless. */
  const data = pixels([[100, 100, 100, 255, 10], [102, 101, 103, 255, 10]]);
  const palette = topColours(data, 6, { stride: 1 });
  assert.equal(palette.length, 1, `expected one bucket, got ${palette.map(p => p.hex)}`);
});

test('transparent pixels are not part of the palette', () => {
  /* A logo on a transparent canvas otherwise comes back as six shades
     of black, because unset RGBA is 0,0,0,0. */
  const data = pixels([[0, 0, 0, 0, 500], [201, 168, 76, 255, 5]]);
  const palette = topColours(data, 6, { stride: 1 });
  assert.equal(palette.length, 1, `expected only the opaque colour, got ${palette.map(p => p.hex)}`);

  /* Derived from the declared bucket size rather than hard-coded, so
     changing paletteStep does not silently invalidate this test. */
  const step = GENAI_LIMITS.paletteStep;
  const bucket = [201, 168, 76]
    .map(v => Math.min(255, Math.round(v / step) * step).toString(16).padStart(2, '0'))
    .join('');
  assert.equal(palette[0].hex, `#${bucket}`);
});

test('the same image always produces the same palette', () => {
  /* Two colours on an identical count must not swap between runs, or the
     generated scaffold changes for no reason. */
  const data = pixels([[10, 10, 10, 255, 7], [200, 200, 200, 255, 7]]);
  const first = topColours(data, 6, { stride: 1 }).map(c => c.hex);
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(topColours(data, 6, { stride: 1 }).map(c => c.hex), first);
  }
});

test('an empty or unreadable buffer yields an empty palette rather than throwing', () => {
  for (const data of [[], [0, 0, 0], pixels([[0, 0, 0, 0, 4]])]) {
    assert.doesNotThrow(() => topColours(data, 6, { stride: 1 }));
    assert.deepEqual(topColours(data, 6, { stride: 1 }), []);
  }
});

test('the palette is capped at what was asked for', () => {
  const data = pixels(Array.from({ length: 20 }, (_, i) => [i * 12, 0, 0, 255, 20 - i]));
  assert.equal(topColours(data, 4, { stride: 1 }).length, 4);
  assert.ok(topColours(data, undefined, { stride: 1 }).length <= GENAI_LIMITS.paletteColours);
});

/* ============ THE SCAFFOLD ============ */

test('the scaffold is a complete, well-formed document', () => {
  const html = scaffoldHtml({
    title: 'Homepage', width: 1440, height: 900,
    palette: [{ hex: '#111111' }, { hex: '#c9a84c' }],
    src: 'data:image/png;base64,AAAA', alt: 'A homepage mockup',
  });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<\/html>\s*$/);
  assert.match(html, /width="1440" height="900"/);
  assert.match(html, /--colour-1: #111111;/);
  assert.match(html, /--colour-2: #c9a84c;/);
  assert.match(html, /alt="A homepage mockup"/);
});

test('the scaffold says in writing that it has not inferred the layout', () => {
  /* This is the whole reason the tool is allowed to exist in this state.
     If the disclaimer is ever refactored out, the output starts reading
     as a finished conversion of the design. */
  const html = scaffoldHtml({ title: 'x', width: 10, height: 10, palette: [], src: 'data:,', alt: 'x' });
  assert.match(html, /not.*the layout/is);
  assert.match(html, /vision model/i);
});

test('everything the visitor supplied is escaped', () => {
  const html = scaffoldHtml({
    title: '</title><script>alert(1)</script>',
    width: 10,
    height: 10,
    palette: [{ hex: '"><script>alert(2)</script>' }],
    src: '" onerror="alert(3)',
    alt: '" onload="alert(4)',
  });
  assert.doesNotMatch(html, /<script>alert/, 'a filename must not become a live tag');
  assert.doesNotMatch(html, /onerror="alert/, 'the src must not break out of its attribute');
  assert.doesNotMatch(html, /onload="alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('junk dimensions and a missing palette do not produce broken CSS', () => {
  for (const spec of [undefined, null, {}, { width: 0, height: -5 }, { width: 'abc' }, { palette: 'not an array' }]) {
    assert.doesNotThrow(() => scaffoldHtml(spec));
    const html = scaffoldHtml(spec);
    assert.match(html, /--colour-1:/, 'there must always be at least one custom property to reference');
    assert.doesNotMatch(html, /width="0"|width="-\d|width="NaN"/);
    assert.doesNotMatch(html, /var\(--colour-0\)/, 'a zero-length palette must not index colour 0');
  }
});

test('escapeHtml covers attribute-breaking characters', () => {
  assert.equal(escapeHtml('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(escapeHtml(null), '');
});

/* ============ THE PAGE ============ */

test('the bench page wires up every control its script reads', () => {
  /* The panels bail silently when an element is missing, which is right
     at runtime and invisible in review: a renamed id turns a working
     tool into a dead button with no error anywhere. */
  const html = fs.readFileSync(path.join(ROOT, 'genai.html'), 'utf8');
  const required = [
    'vid-drop', 'vid-file', 'vid-pick', 'vid-player', 'vid-status', 'vid-meta',
    'vid-controls', 'vid-time', 'vid-time-label', 'vid-count', 'vid-format',
    'vid-strip', 'vid-grab-one', 'vid-grab-many',
    'ih-drop', 'ih-file', 'ih-pick', 'ih-output', 'ih-palette', 'ih-status',
    'ih-copy', 'ih-download',
  ];
  const missing = required.filter(id => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `genai.js reads these ids, and the page does not declare them:\n  ${missing.join('\n  ')}`);
});

test('the bench page permits the blob URLs its own tools create', () => {
  /* A canvas preview and a <video> source are both blob: URLs. Without
     them in the CSP the panels work perfectly and display nothing, which
     is the hardest kind of bug to see. */
  const html = fs.readFileSync(path.join(ROOT, 'genai.html'), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /img-src[^;]*blob:/, 'the frame previews are blob: URLs');
  assert.match(csp, /media-src[^;]*blob:/, 'the <video> source is a blob: URL');
});
