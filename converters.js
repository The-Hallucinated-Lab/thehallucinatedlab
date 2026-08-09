/* ============================================================
   converters.js — the Converters page.

   The document half of the Converters page: a registry of conversions
   from text to text. Every one is a pure function, which is the whole
   reason this page needs no backend — no upload, no queue, no worker,
   and it keeps working with the network off.

   The other two thirds of the page live next door: convert-scales.js
   holds the quantity converters (units, number bases, colour, time), and
   converters-ui.js holds every line that touches the DOM.

   That constraint is also what is NOT here. Video, audio, PDF and Office
   documents are the headline of every hosted converter, and each needs
   either a server or a multi-megabyte wasm build — a third-party runtime
   dependency this site does not permit. Rather than ship a
   convincing-looking control that fails on a real file, those formats
   are absent and the page says so in print.

   Adding a conversion: append to TEXT_CONVERSIONS. The <select> options,
   the group tabs, the hint line and the tests all read from there, so a
   new entry needs no UI work and cannot ship without a description.
   ============================================================ */

/* @pure-start — everything between these markers is free of DOM,
   storage and network access, and is loaded directly by
   test/converters.test.js. Keep it that way. */

/* ============ SHARED HELPERS ============ */

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Every conversion reports failure the same way, so the UI has one error
   path rather than one per converter. A thrown string would lose the
   stack and `no-throw-literal` forbids it anyway. */
class ConversionError extends Error {}

function fail(message) {
  throw new ConversionError(message);
}

function requireText(input, what) {
  const text = String(input == null ? '' : input).trim();
  if (!text) fail(`Paste some ${what} first.`);
  return text;
}

/* ============ DELIMITED TEXT ============
   A hand-rolled RFC 4180 reader rather than a split on commas. The split
   version is four characters long and wrong the moment a field contains
   a comma, a quote or a newline — which in real exports is immediately. */
function parseDelimited(text, delimiter) {
  const delim = delimiter || ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const src = String(text == null ? '' : text);

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < src.length) {
    const ch = src[i];

    if (quoted) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }

    if (ch === '"' && field === '') { quoted = true; i += 1; continue; }
    if (ch === delim) { endField(); i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }          // CRLF and lone CR both end a row
    if (ch === '\n') { endRow(); i += 1; continue; }

    field += ch; i += 1;
  }

  // A trailing newline should not manufacture an empty final row.
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/* Quotes only what has to be quoted, so output stays readable and
   diffable rather than every field being wrapped. */
function toDelimited(rows, delimiter) {
  const delim = delimiter || ',';
  const needsQuote = new RegExp(`["\\n\\r${delim === '\t' ? '\\t' : delim}]`);
  return rows.map(row => row.map(cell => {
    const value = cell == null ? '' : String(cell);
    return needsQuote.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(delim)).join('\n');
}

/* Counts candidates on the first line rather than across the file: a
   comma inside a quoted field on line 40 should not outvote 12 real
   tabs on line 1. */
function sniffDelimiter(text) {
  const [first = ''] = String(text == null ? '' : text).split(/\r?\n/);
  const counts = [['\t', 0], [';', 0], ['|', 0], [',', 0]].map(([d]) => [d, first.split(d).length - 1]);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a), [',', 0]);
  return best[1] > 0 ? best[0] : ',';
}

function parseJsonOrFail(text, what) {
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(`That is not valid ${what || 'JSON'}: ${err.message}`);
  }
  return undefined;   // unreachable; keeps the return type honest
}

/* Rows of objects is the only shape that can become a table. Anything
   else has to be rejected by name, or the output is "[object Object]"
   in every cell. */
function asRecords(value) {
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0) fail('That JSON is an empty array — nothing to convert.');
  for (const item of list) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      fail('Expected an array of objects, one per row.');
    }
  }
  return list;
}

/* Column order follows first appearance across every record, not just
   the first one, so a field only some rows carry still gets a column. */
function recordColumns(records) {
  const seen = [];
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.includes(key)) seen.push(key);
    }
  }
  return seen;
}

function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/* A CSV cell is text. Turning "1.0" into 1 loses the distinction the
   source made, and turning a leading-zero id like "007" into 7 corrupts
   it — so only unambiguous round-trips are coerced. */
function coerceCell(value) {
  if (value === '') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
    const n = Number(value);
    if (String(n) === value) return n;
  }
  return value;
}

function rowsToRecords(rows, coerce) {
  if (rows.length === 0) fail('There are no rows in that.');
  const [header, ...body] = rows;
  if (header.length === 0) fail('The first row has no columns to use as keys.');
  return body.map(row => {
    const record = {};
    header.forEach((key, idx) => {
      const raw = row[idx] === undefined ? '' : row[idx];
      record[key || `column_${idx + 1}`] = coerce ? coerceCell(raw) : raw;
    });
    return record;
  });
}

/* ============ MARKDOWN TABLES ============ */
function toMarkdownTable(rows) {
  if (rows.length === 0) fail('There are no rows in that.');
  const width = Math.max(...rows.map(r => r.length));
  const pad = row => Array.from({ length: width }, (_, i) => String(row[i] == null ? '' : row[i]).replace(/\|/g, '\\|'));
  const [header, ...body] = rows;
  return [
    `| ${pad(header).join(' | ')} |`,
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...body.map(row => `| ${pad(row).join(' | ')} |`),
  ].join('\n');
}

function parseMarkdownTable(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows = lines
    .filter(line => line.startsWith('|'))
    /* The |---|---| separator is layout, not data. */
    .filter(line => !/^\|[\s:|-]+\|$/.test(line))
    .map(line => line.replace(/^\|/, '').replace(/\|$/, '')
      .split(/(?<!\\)\|/)
      .map(cell => cell.trim().replace(/\\\|/g, '|')));
  if (rows.length === 0) fail('No Markdown table rows found — lines should start with "|".');
  return rows;
}

/* ============ CASE STYLES ============
   One splitter for all of them: the hard part is not joining the words,
   it is deciding where they start. "parseHTTPResponse" is three words,
   and a naive /[A-Z]/ split makes it four. */
function splitWords(text) {
  return String(text == null ? '' : text)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

const TITLE_MINOR = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'the', 'to', 'up', 'via']);

const CASE_STYLES = {
  camel: words => words.map((w, i) => (i === 0 ? w.toLowerCase() : capitalise(w))).join(''),
  pascal: words => words.map(capitalise).join(''),
  snake: words => words.map(w => w.toLowerCase()).join('_'),
  kebab: words => words.map(w => w.toLowerCase()).join('-'),
  constant: words => words.map(w => w.toUpperCase()).join('_'),
  dot: words => words.map(w => w.toLowerCase()).join('.'),
  sentence: words => words.map((w, i) => (i === 0 ? capitalise(w) : w.toLowerCase())).join(' '),
  title: words => words.map((w, i) => {
    const lower = w.toLowerCase();
    return i > 0 && TITLE_MINOR.has(lower) ? lower : capitalise(w);
  }).join(' '),
};

function capitalise(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function toCase(text, style) {
  const fn = CASE_STYLES[style];
  if (!fn) fail(`Unknown case style "${style}".`);
  const words = splitWords(text);
  if (words.length === 0) fail('No words found in that.');
  return fn(words);
}

function slugify(text) {
  const slug = String(text == null ? '' : text)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) fail('That leaves nothing usable as a slug.');
  return slug;
}

/* ============ ENCODINGS ============
   btoa and atob are byte-oriented, so anything outside Latin-1 has to
   go through UTF-8 by hand. Without this, one emoji throws
   InvalidCharacterError and the page looks broken rather than the input
   looking unsupported. */
function utf8Bytes(text) {
  const out = [];
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return out;
}

function utf8Decode(bytes) {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let cp;
    let size;
    if (b < 0x80) { cp = b; size = 1; }
    else if (b >= 0xc0 && b < 0xe0) { cp = b & 0x1f; size = 2; }
    else if (b >= 0xe0 && b < 0xf0) { cp = b & 0x0f; size = 3; }
    else if (b >= 0xf0) { cp = b & 0x07; size = 4; }
    else fail('That is not valid UTF-8.');
    if (i + size > bytes.length) fail('That is not valid UTF-8 — it ends mid-character.');
    for (let k = 1; k < size; k++) {
      const cont = bytes[i + k];
      if ((cont & 0xc0) !== 0x80) fail('That is not valid UTF-8.');
      cp = (cp << 6) | (cont & 0x3f);
    }
    out += String.fromCodePoint(cp);
    i += size;
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b === undefined ? 0 : b) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c === undefined ? 0 : c) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}

function base64ToBytes(text) {
  /* URL-safe base64 is the same data in a different alphabet, and
     rejecting it would be pedantry — a JWT segment is the single most
     likely thing to be pasted here. */
  const clean = String(text).trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean)) fail('That is not base64 — it has characters outside the alphabet.');
  if (clean.length % 4 === 1) fail('That base64 is truncated.');
  const bytes = [];
  for (let i = 0; i < clean.length; i += 4) {
    const chunk = clean.slice(i, i + 4).split('').map(ch => B64.indexOf(ch));
    const [a, b, c, d] = chunk;
    bytes.push((a << 2) | (b >> 4));
    if (chunk.length > 2) bytes.push(((b & 15) << 4) | (c >> 2));
    if (chunk.length > 3) bytes.push(((c & 3) << 6) | d);
  }
  return bytes;
}

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ENTITY_NAMES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '©', reg: '®', trade: '™', hellip: '…',
  mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', deg: '°', euro: '€', pound: '£',
};

function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      /* Beyond the Unicode range fromCodePoint throws, and a lone
         surrogate produces text no consumer can use. */
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return whole;
      return String.fromCodePoint(cp);
    }
    const named = ENTITY_NAMES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

/* Deliberately not a parser. Stripping tags is what people want from
   "HTML to text", and doing it with a regex on untrusted input would be
   a hole if the result were re-inserted as HTML — it is not, it goes
   into a textarea's value. */
function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer)>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, '')
  ).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function textToHex(text, separator) {
  return utf8Bytes(text).map(b => b.toString(16).padStart(2, '0')).join(separator === undefined ? ' ' : separator);
}

function hexToText(text) {
  const clean = String(text).replace(/0x/gi, '').replace(/[\s,:-]+/g, '');
  if (!clean) fail('Paste some hex first.');
  if (!/^[0-9a-fA-F]+$/.test(clean)) fail('That has characters that are not hex digits.');
  if (clean.length % 2) fail('Hex needs an even number of digits — two per byte.');
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
  return utf8Decode(bytes);
}

function textToBinary(text) {
  return utf8Bytes(text).map(b => b.toString(2).padStart(8, '0')).join(' ');
}

function binaryToText(text) {
  const clean = String(text).replace(/[^01]/g, '');
  if (!clean) fail('Paste some binary first.');
  if (clean.length % 8) fail('Binary needs a multiple of eight digits — one byte each.');
  const bytes = [];
  for (let i = 0; i < clean.length; i += 8) bytes.push(parseInt(clean.slice(i, i + 8), 2));
  return utf8Decode(bytes);
}

/* ============ THE REGISTRY ============
   `run` takes the raw textarea contents and returns text. Anything it
   cannot do throws a ConversionError with a sentence the visitor can
   act on. */
const TEXT_CONVERSIONS = [
  /* ---- tabular data ---- */
  {
    id: 'csv-to-json', group: 'data', label: 'CSV → JSON',
    hint: 'First row becomes the keys. Quoted fields, embedded commas and newlines are handled.',
    run: text => JSON.stringify(rowsToRecords(parseDelimited(requireText(text, 'CSV'), sniffDelimiter(text)), true), null, 2),
  },
  {
    id: 'json-to-csv', group: 'data', label: 'JSON → CSV',
    hint: 'Expects an array of objects. Columns are the union of every key, in first-seen order.',
    run: (text) => {
      const records = asRecords(parseJsonOrFail(requireText(text, 'JSON')));
      const columns = recordColumns(records);
      return toDelimited([columns, ...records.map(r => columns.map(c => cellText(r[c])))], ',');
    },
  },
  {
    id: 'csv-to-tsv', group: 'data', label: 'CSV → TSV',
    hint: 'Same rows, tab separated. The delimiter of the input is sniffed from its first line.',
    run: text => toDelimited(parseDelimited(requireText(text, 'CSV'), sniffDelimiter(text)), '\t'),
  },
  {
    id: 'tsv-to-csv', group: 'data', label: 'TSV → CSV',
    hint: 'Tab separated in, comma separated out, quoting only the fields that need it.',
    run: text => toDelimited(parseDelimited(requireText(text, 'TSV'), '\t'), ','),
  },
  {
    id: 'csv-to-markdown', group: 'data', label: 'CSV → Markdown table',
    hint: 'For pasting into a README. Pipes inside cells are escaped.',
    run: text => toMarkdownTable(parseDelimited(requireText(text, 'CSV'), sniffDelimiter(text))),
  },
  {
    id: 'markdown-to-csv', group: 'data', label: 'Markdown table → CSV',
    hint: 'The |---| separator row is dropped; everything else becomes a row.',
    run: text => toDelimited(parseMarkdownTable(requireText(text, 'a Markdown table')), ','),
  },
  {
    id: 'csv-to-html', group: 'data', label: 'CSV → HTML table',
    hint: 'A real <table> with a <thead>, escaped. LLMs and screen readers both read these far better than prose.',
    run: (text) => {
      const rows = parseDelimited(requireText(text, 'CSV'), sniffDelimiter(text));
      if (rows.length === 0) fail('There are no rows in that.');
      const [header, ...body] = rows;
      const cells = (row, tag) => row.map(c => `      <${tag}>${escapeHtml(c)}</${tag}>`).join('\n');
      return [
        '<table>',
        '  <thead>',
        '    <tr>',
        cells(header, 'th'),
        '    </tr>',
        '  </thead>',
        '  <tbody>',
        ...body.map(row => ['    <tr>', cells(row, 'td'), '    </tr>'].join('\n')),
        '  </tbody>',
        '</table>',
      ].join('\n');
    },
  },
  {
    id: 'json-to-jsonl', group: 'data', label: 'JSON → JSONL',
    hint: 'One record per line, which is what streams and greps well.',
    run: (text) => {
      const value = parseJsonOrFail(requireText(text, 'JSON'));
      const list = Array.isArray(value) ? value : [value];
      return list.map(item => JSON.stringify(item)).join('\n');
    },
  },
  {
    id: 'jsonl-to-json', group: 'data', label: 'JSONL → JSON',
    hint: 'Line-delimited records back into one indented array. A bad line is reported by number.',
    run: text => JSON.stringify(
      requireText(text, 'JSONL').split(/\r?\n/).filter(l => l.trim()).map((line, i) => {
        try {
          return JSON.parse(line);
        } catch (err) {
          return fail(`Line ${i + 1} is not valid JSON: ${err.message}`);
        }
      }), null, 2),
  },
  {
    id: 'json-pretty', group: 'data', label: 'JSON → pretty',
    hint: 'Two-space indent, keys left in their original order.',
    run: text => JSON.stringify(parseJsonOrFail(requireText(text, 'JSON')), null, 2),
  },
  {
    id: 'json-minify', group: 'data', label: 'JSON → minified',
    hint: 'Every byte of whitespace removed.',
    run: text => JSON.stringify(parseJsonOrFail(requireText(text, 'JSON'))),
  },
  {
    id: 'json-sort-keys', group: 'data', label: 'JSON → keys sorted',
    hint: 'Recursively alphabetises object keys, so two exports can be diffed.',
    run: (text) => {
      const sort = (value) => {
        if (Array.isArray(value)) return value.map(sort);
        if (value && typeof value === 'object') {
          return Object.keys(value).sort().reduce((out, key) => Object.assign(out, { [key]: sort(value[key]) }), {});
        }
        return value;
      };
      return JSON.stringify(sort(parseJsonOrFail(requireText(text, 'JSON'))), null, 2);
    },
  },
  {
    id: 'lines-to-json', group: 'data', label: 'Lines → JSON array',
    hint: 'Each non-empty line becomes a string in an array.',
    run: text => JSON.stringify(requireText(text, 'text').split(/\r?\n/).map(l => l.trim()).filter(Boolean), null, 2),
  },
  {
    id: 'query-to-json', group: 'data', label: 'Query string → JSON',
    hint: 'Percent-decoded. A key that repeats becomes an array.',
    run: (text) => {
      const raw = requireText(text, 'a query string').replace(/^[^?]*\?/, '').replace(/^[?&]+/, '');
      /* A valueless parameter is legal inside a query string, but a whole
         input with no "=" anywhere is prose, not a query string — without
         this, "no pairs here" converts to one key with an empty value. */
      if (!raw.includes('=')) fail('No key=value pairs found in that.');
      const out = {};
      for (const pair of raw.split('&').filter(Boolean)) {
        const idx = pair.indexOf('=');
        const key = decodeURIComponent((idx === -1 ? pair : pair.slice(0, idx)).replace(/\+/g, ' '));
        const value = idx === -1 ? '' : decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
        if (key in out) out[key] = [].concat(out[key], value);
        else out[key] = value;
      }
      if (Object.keys(out).length === 0) fail('No key=value pairs found in that.');
      return JSON.stringify(out, null, 2);
    },
  },
  {
    id: 'json-to-query', group: 'data', label: 'JSON → query string',
    hint: 'Flat objects only. Array values repeat the key.',
    run: (text) => {
      const value = parseJsonOrFail(requireText(text, 'JSON'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected a flat JSON object.');
      const parts = [];
      for (const [key, raw] of Object.entries(value)) {
        for (const item of [].concat(raw)) {
          if (item !== null && typeof item === 'object') fail(`"${key}" is nested — a query string cannot carry that.`);
          parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(item == null ? '' : item)}`);
        }
      }
      return parts.join('&');
    },
  },

  /* ---- encodings ---- */
  {
    id: 'text-to-base64', group: 'encoding', label: 'Text → Base64',
    hint: 'UTF-8 encoded first, so accents and emoji survive.',
    run: text => bytesToBase64(utf8Bytes(requireText(text, 'text'))),
  },
  {
    id: 'base64-to-text', group: 'encoding', label: 'Base64 → Text',
    hint: 'Accepts the URL-safe alphabet and missing padding, so a JWT segment pastes straight in.',
    run: text => utf8Decode(base64ToBytes(requireText(text, 'base64'))),
  },
  {
    id: 'text-to-url', group: 'encoding', label: 'Text → URL encoded',
    hint: 'Percent-encodes everything a URL component cannot carry.',
    run: text => encodeURIComponent(requireText(text, 'text')),
  },
  {
    id: 'url-to-text', group: 'encoding', label: 'URL encoded → Text',
    hint: 'Also turns + back into a space, the way form encoding means it.',
    run: (text) => {
      try {
        return decodeURIComponent(requireText(text, 'an encoded string').replace(/\+/g, ' '));
      } catch (err) {
        return fail('That has a % escape that is not valid — check for a stray %.');
      }
    },
  },
  {
    id: 'text-to-entities', group: 'encoding', label: 'Text → HTML entities',
    hint: 'Escapes the five characters that change meaning inside markup.',
    run: text => String(requireText(text, 'text')).replace(/[&<>"']/g, ch => ENTITIES[ch]),
  },
  {
    id: 'entities-to-text', group: 'encoding', label: 'HTML entities → Text',
    hint: 'Named and numeric entities, decimal or hex.',
    run: text => decodeEntities(requireText(text, 'text')),
  },
  {
    id: 'html-to-text', group: 'encoding', label: 'HTML → plain text',
    hint: 'Tags removed, block ends become newlines, list items become dashes.',
    run: text => htmlToText(requireText(text, 'HTML')),
  },
  {
    id: 'text-to-hex', group: 'encoding', label: 'Text → Hex',
    hint: 'Space-separated UTF-8 bytes.',
    run: text => textToHex(requireText(text, 'text')),
  },
  {
    id: 'hex-to-text', group: 'encoding', label: 'Hex → Text',
    hint: 'Spaces, colons, dashes and 0x prefixes are all ignored.',
    run: text => hexToText(requireText(text, 'hex')),
  },
  {
    id: 'text-to-binary', group: 'encoding', label: 'Text → Binary',
    hint: 'Eight digits per UTF-8 byte.',
    run: text => textToBinary(requireText(text, 'text')),
  },
  {
    id: 'binary-to-text', group: 'encoding', label: 'Binary → Text',
    hint: 'Anything that is not a 0 or a 1 is treated as a separator.',
    run: text => binaryToText(requireText(text, 'binary')),
  },
  {
    id: 'text-to-json-string', group: 'encoding', label: 'Text → JSON string',
    hint: 'Quotes, newlines and control characters escaped, ready to paste into a JSON file.',
    run: text => JSON.stringify(String(requireText(text, 'text'))),
  },

  /* ---- naming ---- */
  ...Object.keys(CASE_STYLES).map(style => ({
    id: `case-${style}`,
    group: 'naming',
    label: `Text → ${style === 'constant' ? 'CONSTANT_CASE' : `${style} case`}`,
    hint: 'Word boundaries are found first, so camelCase, snake_case and "Title Case" all convert cleanly.',
    run: text => toCase(requireText(text, 'text'), style),
  })),
  {
    id: 'text-to-slug', group: 'naming', label: 'Text → URL slug',
    hint: 'Lowercased, punctuation dropped, spaces to hyphens.',
    run: text => slugify(requireText(text, 'text')),
  },
  {
    id: 'text-upper', group: 'naming', label: 'Text → UPPERCASE',
    hint: 'Locale-independent, so it does not surprise on Turkish input.',
    run: text => String(requireText(text, 'text')).toUpperCase(),
  },
  {
    id: 'text-lower', group: 'naming', label: 'Text → lowercase',
    hint: 'Locale-independent.',
    run: text => String(requireText(text, 'text')).toLowerCase(),
  },
];

const CONVERSION_GROUPS = [
  { id: 'data', label: 'Data & tables' },
  { id: 'encoding', label: 'Encoding' },
  { id: 'naming', label: 'Naming & case' },
];

function conversionById(id) {
  return TEXT_CONVERSIONS.find(c => c.id === id) || null;
}

/* One entry point for the UI: never throws, always returns something
   renderable. Every converter's failure mode reaches the visitor as a
   sentence rather than as a console error nobody sees. */
function runConversion(id, input) {
  const conversion = conversionById(id);
  if (!conversion) return { ok: false, error: 'Pick a conversion first.' };
  try {
    return { ok: true, output: String(conversion.run(input)) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof ConversionError ? err.message : 'That input could not be converted.',
    };
  }
}

/* @pure-end */

/* Page scripts here are plain <script> files sharing one global scope, so
   converters-ui.js reaches this through the site's single THL namespace
   rather than a dozen bare globals — the same way eda.js reaches
   eda-engine.js. */
window.THL = window.THL || {};
window.THL.convert = {
  TEXT_CONVERSIONS: TEXT_CONVERSIONS,
  CONVERSION_GROUPS: CONVERSION_GROUPS,
  conversionById: conversionById,
  runConversion: runConversion,
  escapeHtml: escapeHtml,
};
