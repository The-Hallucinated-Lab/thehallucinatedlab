/* ============================================================
   converters.test.js — the Converters page.

   Every converter is a pure function, so all of it is testable without a
   browser, and the things that break converters are exactly the things a
   quick manual check never covers: a comma inside a quoted CSV field, an
   emoji through base64, a leading-zero id silently becoming a number, a
   digit that is not legal in its own base.

   Two engines are covered here, both loaded from their @pure blocks:
   converters.js (documents) and convert-scales.js (quantities).
   ============================================================ */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPure } = require('./helpers/load-pure');

const {
  TEXT_CONVERSIONS, CONVERSION_GROUPS, conversionById, runConversion,
  parseDelimited, toDelimited, sniffDelimiter, coerceCell,
  toMarkdownTable, parseMarkdownTable,
  bytesToBase64, base64ToBytes, utf8Bytes, utf8Decode,
  decodeEntities, htmlToText, splitWords, toCase, slugify, escapeHtml,
} = loadPure('converters.js', [
  'TEXT_CONVERSIONS', 'CONVERSION_GROUPS', 'conversionById', 'runConversion',
  'parseDelimited', 'toDelimited', 'sniffDelimiter', 'coerceCell',
  'toMarkdownTable', 'parseMarkdownTable',
  'bytesToBase64', 'base64ToBytes', 'utf8Bytes', 'utf8Decode',
  'decodeEntities', 'htmlToText', 'splitWords', 'toCase', 'slugify', 'escapeHtml',
]);

const {
  BASE_LIMITS, UNIT_GROUPS, convertBase, convertUnit, unitTable,
  colourFormats, rgbToHex, timeFormats, formatQuantity, contrastRatio,
} = loadPure('convert-scales.js', [
  'BASE_LIMITS', 'UNIT_GROUPS', 'convertBase', 'convertUnit', 'unitTable',
  'colourFormats', 'rgbToHex', 'timeFormats', 'formatQuantity', 'contrastRatio',
]);

/* Convenience: the value, or the error, of a registry conversion. */
const run = (id, input) => runConversion(id, input);
const out = (id, input) => {
  const result = runConversion(id, input);
  assert.equal(result.ok, true, `${id} failed: ${result.error}`);
  return result.output;
};

/* ============================================================
   THE REGISTRY ITSELF
   ============================================================ */

test('every conversion declares what the UI and the tests both read', () => {
  assert.ok(TEXT_CONVERSIONS.length >= 25, `only ${TEXT_CONVERSIONS.length} conversions declared`);
  const ids = new Set();
  const groups = new Set(CONVERSION_GROUPS.map(g => g.id));

  for (const conversion of TEXT_CONVERSIONS) {
    for (const field of ['id', 'group', 'label', 'hint']) {
      assert.ok(conversion[field], `a conversion is missing ${field}: ${JSON.stringify(conversion.id)}`);
    }
    assert.equal(typeof conversion.run, 'function', `${conversion.id} has no run()`);
    assert.ok(!ids.has(conversion.id), `duplicate id ${conversion.id}`);
    ids.add(conversion.id);
    assert.ok(groups.has(conversion.group), `${conversion.id} is in unknown group "${conversion.group}"`);
  }

  /* A group with no conversions renders an empty <select>, which looks
     like the page is broken. */
  for (const group of CONVERSION_GROUPS) {
    assert.ok(TEXT_CONVERSIONS.some(c => c.group === group.id), `group "${group.id}" is empty`);
  }
});

test('no conversion throws, whatever it is handed', () => {
  /* runConversion is the single entry point the UI calls, and the UI has
     no catch block. Anything that escapes here reaches the visitor as a
     dead button. */
  const nasties = ['', '   ', '\n\n', 'null', '{', '[]', '<script>alert(1)</script>',
    '\u0000', '💥', 'a'.repeat(5000), undefined, null, 42, {}, []];

  for (const conversion of TEXT_CONVERSIONS) {
    for (const input of nasties) {
      assert.doesNotThrow(() => run(conversion.id, input), `${conversion.id} threw on ${JSON.stringify(input)}`);
      const result = run(conversion.id, input);
      assert.equal(typeof result.ok, 'boolean', `${conversion.id} returned no ok flag`);
      if (!result.ok) {
        assert.equal(typeof result.error, 'string', `${conversion.id} failed with no message`);
        assert.ok(result.error.length > 5, `${conversion.id} error is not a sentence: ${result.error}`);
      }
    }
  }
});

test('an empty input is refused with a sentence, not with empty output', () => {
  for (const conversion of TEXT_CONVERSIONS) {
    const result = run(conversion.id, '   ');
    assert.equal(result.ok, false, `${conversion.id} accepted whitespace as input`);
  }
});

test('an unknown conversion id is handled rather than crashing', () => {
  assert.equal(run('does-not-exist', 'x').ok, false);
  assert.equal(conversionById('does-not-exist'), null);
  assert.ok(conversionById('csv-to-json'));
});

/* ============================================================
   DELIMITED TEXT
   ============================================================ */

test('the CSV reader survives what a split on commas cannot', () => {
  assert.deepEqual(parseDelimited('a,b\n1,2', ','), [['a', 'b'], ['1', '2']]);

  // A comma inside a quoted field is data, not a separator.
  assert.deepEqual(parseDelimited('name,note\n"Ada, Countess",fine', ','),
    [['name', 'note'], ['Ada, Countess', 'fine']]);

  // A doubled quote is one literal quote.
  assert.deepEqual(parseDelimited('a\n"she said ""hi"""', ','), [['a'], ['she said "hi"']]);

  // A newline inside a quoted field does not end the row.
  assert.deepEqual(parseDelimited('a,b\n"line one\nline two",x', ','),
    [['a', 'b'], ['line one\nline two', 'x']]);

  // CRLF from a Windows export.
  assert.deepEqual(parseDelimited('a,b\r\n1,2\r\n', ','), [['a', 'b'], ['1', '2']]);

  // A trailing newline must not manufacture a phantom empty row.
  assert.equal(parseDelimited('a,b\n1,2\n', ',').length, 2);
  assert.deepEqual(parseDelimited('', ','), []);
});

test('writing delimited text quotes only what has to be quoted', () => {
  assert.equal(toDelimited([['a', 'b'], ['1', '2']], ','), 'a,b\n1,2');
  assert.equal(toDelimited([['plain', 'has,comma']], ','), 'plain,"has,comma"');
  assert.equal(toDelimited([['say "hi"']], ','), '"say ""hi"""');
  assert.equal(toDelimited([['two\nlines']], ','), '"two\nlines"');
  assert.equal(toDelimited([['a\tb']], '\t'), '"a\tb"', 'a tab inside a TSV field needs quoting');
  assert.equal(toDelimited([['a,b']], '\t'), 'a,b', 'a comma in a TSV field does not');
});

test('a round trip through CSV keeps every field intact', () => {
  const rows = [['id', 'note'], ['1', 'has, comma'], ['2', 'has "quotes"'], ['3', 'has\nnewline']];
  assert.deepEqual(parseDelimited(toDelimited(rows, ','), ','), rows);
});

test('the delimiter is sniffed from the header, not from the whole file', () => {
  assert.equal(sniffDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(sniffDelimiter('a;b;c'), ';');
  assert.equal(sniffDelimiter('a|b|c'), '|');
  assert.equal(sniffDelimiter('a,b,c'), ',');
  assert.equal(sniffDelimiter('single'), ',', 'no delimiter at all still has to pick one');

  /* A comma inside a quoted field further down the file must not outvote
     the real tabs in the header. */
  assert.equal(sniffDelimiter('a\tb\n"x, y, z"\tq'), '\t');
});

/* ============================================================
   CSV <-> JSON
   ============================================================ */

test('CSV to JSON uses the header as keys and coerces only what is safe', () => {
  const parsed = JSON.parse(out('csv-to-json', 'id,name,active,score\n1,Ada,true,9.5'));
  assert.deepEqual(parsed, [{ id: 1, name: 'Ada', active: true, score: 9.5 }]);
});

test('a cell is text until coercing it is provably lossless', () => {
  /* Every one of these has bitten a real spreadsheet import. */
  assert.equal(coerceCell('007'), '007', 'a leading-zero id is not the number 7');
  assert.equal(coerceCell('1.0'), '1.0', '1.0 and 1 are a distinction the source made');
  assert.equal(coerceCell('+1'), '+1');
  assert.equal(coerceCell('1e999'), '1e999', 'beyond double range it would become Infinity');
  assert.equal(coerceCell('0x10'), '0x10');
  assert.equal(coerceCell(''), '');
  assert.equal(coerceCell('42'), 42);
  assert.equal(coerceCell('-3.5'), -3.5);
  assert.equal(coerceCell('true'), true);
  assert.equal(coerceCell('false'), false);
  assert.equal(coerceCell('null'), null);
});

test('JSON to CSV takes the union of keys, in first-seen order', () => {
  const csv = out('json-to-csv', '[{"a":1,"b":2},{"b":3,"c":4}]');
  assert.equal(csv.split('\n')[0], 'a,b,c', 'a key only the second row carries still needs a column');
  assert.deepEqual(parseDelimited(csv, ','), [['a', 'b', 'c'], ['1', '2', ''], ['', '3', '4']]);
});

test('JSON to CSV says what it needs rather than printing [object Object]', () => {
  assert.equal(run('json-to-csv', '{"a":1}').ok, true, 'a lone object is one row');
  assert.match(run('json-to-csv', '[1,2,3]').error, /array of objects/);
  assert.match(run('json-to-csv', '[]').error, /empty/);
  assert.match(run('json-to-csv', 'not json').error, /not valid JSON/);
});

test('a nested value in a CSV cell is serialised, not stringified to junk', () => {
  const csv = out('json-to-csv', '[{"a":{"deep":1}}]');
  assert.match(csv, /\{""deep"":1\}/);
});

test('CSV survives a round trip out to JSON and back', () => {
  const csv = 'id,note\n1,"has, comma"\n2,plain';
  assert.deepEqual(
    parseDelimited(out('json-to-csv', out('csv-to-json', csv)), ','),
    parseDelimited(csv, ','),
  );
});

test('TSV and CSV convert both ways', () => {
  assert.equal(out('csv-to-tsv', 'a,b\n1,2'), 'a\tb\n1\t2');
  assert.equal(out('tsv-to-csv', 'a\tb\n1\t2'), 'a,b\n1,2');
});

/* ============================================================
   MARKDOWN AND HTML TABLES
   ============================================================ */

test('a Markdown table round trips through CSV', () => {
  const md = out('csv-to-markdown', 'name,role\nAda,maths');
  assert.equal(md.split('\n')[1], '| --- | --- |', 'the separator row is what makes it a table');
  assert.deepEqual(parseMarkdownTable(md), [['name', 'role'], ['Ada', 'maths']]);
  assert.equal(out('markdown-to-csv', md), 'name,role\nAda,maths');
});

test('a pipe inside a cell is escaped rather than splitting the row', () => {
  const md = toMarkdownTable([['a'], ['x|y']]);
  assert.match(md, /x\\\|y/);
  assert.deepEqual(parseMarkdownTable(md), [['a'], ['x|y']]);
});

test('a ragged table is padded rather than losing cells', () => {
  const md = toMarkdownTable([['a', 'b', 'c'], ['1']]);
  assert.equal(md.split('\n')[2], '| 1 |  |  |');
});

test('Markdown table input that is not a table is refused', () => {
  assert.match(run('markdown-to-csv', 'just some prose').error, /Markdown table/);
});

test('CSV to HTML escapes every cell', () => {
  const html = out('csv-to-html', 'a\n<script>alert(1)</script>');
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/, 'an unescaped tag here would be an injection in whatever consumes it');
  assert.match(html, /<thead>/);
  assert.match(html, /<th>a<\/th>/);
});

/* ============================================================
   JSON SHAPES
   ============================================================ */

test('JSON reformatting does not change the data', () => {
  const source = '{"b":1,"a":[2,3],"c":{"d":null}}';
  assert.deepEqual(JSON.parse(out('json-pretty', source)), JSON.parse(source));
  assert.deepEqual(JSON.parse(out('json-minify', source)), JSON.parse(source));
  assert.equal(out('json-minify', source).includes(' '), false);
  assert.match(out('json-pretty', source), /\n {2}"b"/);
});

test('sorting keys is recursive and stable', () => {
  const sorted = out('json-sort-keys', '{"b":1,"a":{"z":1,"y":2}}');
  assert.equal(sorted.indexOf('"a"') < sorted.indexOf('"b"'), true);
  assert.equal(sorted.indexOf('"y"') < sorted.indexOf('"z"'), true, 'nested objects sort too');
});

test('JSONL and JSON convert both ways, and a bad line is named', () => {
  assert.equal(out('json-to-jsonl', '[{"a":1},{"a":2}]'), '{"a":1}\n{"a":2}');
  assert.deepEqual(JSON.parse(out('jsonl-to-json', '{"a":1}\n{"a":2}')), [{ a: 1 }, { a: 2 }]);
  assert.match(run('jsonl-to-json', '{"a":1}\nnot json').error, /Line 2/);
});

test('lines become a JSON array without the blank ones', () => {
  assert.deepEqual(JSON.parse(out('lines-to-json', 'one\n\n  two  \nthree')), ['one', 'two', 'three']);
});

test('query strings and JSON convert both ways', () => {
  assert.deepEqual(
    JSON.parse(out('query-to-json', '?a=1&b=hello+world&b=two')),
    { a: '1', b: ['hello world', 'two'] },
  );
  assert.deepEqual(
    JSON.parse(out('query-to-json', 'https://example.com/x?q=a%20b')),
    { q: 'a b' },
  );
  assert.equal(out('json-to-query', '{"a":"1","b":["x","y"]}'), 'a=1&b=x&b=y');
  assert.match(run('json-to-query', '{"a":{"nested":1}}').error, /nested/);
  assert.match(run('query-to-json', 'no pairs here').error, /No key=value/);
});

/* ============================================================
   ENCODINGS
   ============================================================ */

test('UTF-8 survives a base64 round trip', () => {
  for (const sample of ['hello', 'héllo wörld', '日本語', '👩‍💻 emoji', 'a', 'ab', 'abc']) {
    assert.equal(out('base64-to-text', out('text-to-base64', sample)), sample, `lost: ${sample}`);
  }
});

test('base64 padding is produced correctly at every remainder', () => {
  assert.equal(out('text-to-base64', 'a'), 'YQ==');
  assert.equal(out('text-to-base64', 'ab'), 'YWI=');
  assert.equal(out('text-to-base64', 'abc'), 'YWJj');
});

test('base64 decoding accepts the URL-safe alphabet and missing padding', () => {
  /* The single most likely thing to be pasted into this box is a JWT
     segment, which is URL-safe and unpadded. */
  assert.equal(utf8Decode(base64ToBytes('aGVsbG8')), 'hello', 'unpadded');

  /* Built rather than hard-coded, so the sample is guaranteed to contain
     the two characters the URL-safe alphabet renames. */
  const bytes = [0xfb, 0xef, 0xbe, 0x00, 0xff];
  const standard = bytesToBase64(bytes);
  assert.match(standard, /[+/]/, 'this sample is meant to exercise + and /');
  const urlSafe = standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.deepEqual(base64ToBytes(urlSafe), bytes, 'url-safe - and _ decode to the same bytes');
  assert.match(run('base64-to-text', 'not base64!!').error, /alphabet/);
  assert.match(run('base64-to-text', 'YQ==YQ==Y').error, /alphabet/, 'padding in the middle is not base64');
  /* Five characters cannot be a whole number of bytes, whatever the
     padding says. */
  assert.match(run('base64-to-text', 'aGVsb').error, /truncated/);
});

test('a base64 round trip is byte-exact for every byte value', () => {
  const bytes = Array.from({ length: 256 }, (_, i) => i);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
});

test('invalid UTF-8 is reported rather than producing replacement junk', () => {
  assert.throws(() => utf8Decode([0xff]), /valid UTF-8/);
  assert.throws(() => utf8Decode([0xe2, 0x82]), /ends mid-character|valid UTF-8/);
  assert.deepEqual(utf8Bytes('€'), [0xe2, 0x82, 0xac]);
});

test('URL encoding round trips, and a broken escape is explained', () => {
  assert.equal(out('url-to-text', out('text-to-url', 'a b/c?d=é')), 'a b/c?d=é');
  assert.equal(out('url-to-text', 'a+b'), 'a b', 'form encoding means + is a space');
  assert.match(run('url-to-text', '%zz').error, /not valid/);
});

test('HTML entities encode and decode', () => {
  assert.equal(out('text-to-entities', '<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.equal(decodeEntities('&lt;b&gt;&amp;&#39;&#x2014;&mdash;'), '<b>&\'——');
  assert.equal(decodeEntities('&notanentity;'), '&notanentity;', 'an unknown entity is left alone');
  assert.equal(decodeEntities('&#x110000;'), '&#x110000;', 'past the Unicode range it is left alone');
});

test('HTML to text keeps the structure a reader needs', () => {
  const html = '<h1>Title</h1><p>One<br>Two</p><ul><li>a</li><li>b</li></ul>';
  const text = htmlToText(html);
  assert.match(text, /^Title/);
  assert.match(text, /One\nTwo/);
  assert.match(text, /- a/);
  assert.doesNotMatch(text, /</);
});

test('HTML to text drops script and style bodies entirely', () => {
  const text = htmlToText('<style>body{color:red}</style><p>keep</p><script>alert(1)</script>');
  assert.equal(text, 'keep', 'code inside script/style is not page text');
});

test('hex and binary round trip, and malformed input is explained', () => {
  assert.equal(out('text-to-hex', 'Hi'), '48 69');
  assert.equal(out('hex-to-text', '48 69'), 'Hi');
  assert.equal(out('hex-to-text', '0x48:0x69'), 'Hi', 'prefixes and separators are ignored');
  assert.equal(out('hex-to-text', out('text-to-hex', '日本 🎈')), '日本 🎈');
  assert.match(run('hex-to-text', '4').error, /even number/);
  assert.match(run('hex-to-text', 'zz').error, /not hex/);

  assert.equal(out('text-to-binary', 'A'), '01000001');
  assert.equal(out('binary-to-text', '01000001'), 'A');
  assert.equal(out('binary-to-text', out('text-to-binary', 'héllo')), 'héllo');
  assert.match(run('binary-to-text', '0100').error, /multiple of eight/);
});

test('text to JSON string escapes what a JSON file cannot carry raw', () => {
  assert.equal(out('text-to-json-string', 'line\n"quoted"'), '"line\\n\\"quoted\\""');
  assert.deepEqual(JSON.parse(out('text-to-json-string', 'a\tb')), 'a\tb');
});

/* ============================================================
   NAMING
   ============================================================ */

test('word boundaries are found before the case is applied', () => {
  assert.deepEqual(splitWords('parseHTTPResponse'), ['parse', 'HTTP', 'Response'],
    'an acronym run is one word, not one per letter');
  assert.deepEqual(splitWords('snake_case_thing'), ['snake', 'case', 'thing']);
  assert.deepEqual(splitWords('kebab-case-thing'), ['kebab', 'case', 'thing']);
  assert.deepEqual(splitWords('Title Case Thing'), ['Title', 'Case', 'Thing']);
  assert.deepEqual(splitWords('mixed_upSTREAM-2 thing'), ['mixed', 'up', 'STREAM', '2', 'thing']);
  assert.deepEqual(splitWords('   '), []);
});

test('each case style produces what its name promises', () => {
  const source = 'parse HTTP response';
  assert.equal(toCase(source, 'camel'), 'parseHttpResponse');
  assert.equal(toCase(source, 'pascal'), 'ParseHttpResponse');
  assert.equal(toCase(source, 'snake'), 'parse_http_response');
  assert.equal(toCase(source, 'kebab'), 'parse-http-response');
  assert.equal(toCase(source, 'constant'), 'PARSE_HTTP_RESPONSE');
  assert.equal(toCase(source, 'dot'), 'parse.http.response');
  assert.equal(toCase(source, 'sentence'), 'Parse http response');
});

test('title case leaves the small words small, except the first', () => {
  assert.equal(toCase('the model is no longer the product', 'title'), 'The Model Is No Longer the Product');
  assert.equal(toCase('a tale of two cities', 'title'), 'A Tale of Two Cities');
});

test('every case style in the registry is reachable and refuses junk', () => {
  const caseIds = TEXT_CONVERSIONS.filter(c => c.id.startsWith('case-')).map(c => c.id);
  assert.ok(caseIds.length >= 8, `only ${caseIds.length} case styles exposed`);
  for (const id of caseIds) {
    assert.equal(run(id, 'hello world').ok, true, `${id} could not convert plain text`);
    assert.equal(run(id, '!!!').ok, false, `${id} accepted input with no words in it`);
  }
});

test('slugs are URL-safe and never empty-but-successful', () => {
  assert.equal(slugify('The Model Is No Longer the Product!'), 'the-model-is-no-longer-the-product');
  assert.equal(slugify("Ada's  notes -- 2026"), 'adas-notes-2026');
  assert.throws(() => slugify('!!!'), /nothing usable/);
});

test('escapeHtml covers attribute-breaking characters', () => {
  assert.equal(escapeHtml('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(escapeHtml(null), '');
});

/* ============================================================
   NUMBER BASES
   ============================================================ */

test('bases convert both ways across the supported range', () => {
  assert.equal(convertBase('255', 10, 16).value, 'ff');
  assert.equal(convertBase('ff', 16, 10).value, '255');
  assert.equal(convertBase('1010', 2, 10).value, '10');
  assert.equal(convertBase('777', 8, 10).value, '511');
  assert.equal(convertBase('zz', 36, 10).value, '1295');
  assert.equal(convertBase('0', 10, 2).value, '0');
  assert.equal(convertBase('-42', 10, 16).value, '-2a');
});

test('prefixes and separators are tolerated', () => {
  assert.equal(convertBase('0xff', 16, 10).value, '255');
  assert.equal(convertBase('1010_1010', 2, 16).value, 'aa');
  assert.equal(convertBase(' 42 ', 10, 10).value, '42');
});

test('a digit that is not legal in its base is refused, not silently truncated', () => {
  /* parseInt('1092', 2) returns 1 with no complaint, which is the bug
     this converter exists to avoid. */
  const bad = convertBase('1092', 2, 10);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /"9" is not a digit in base 2/);
  assert.equal(convertBase('g', 16, 10).ok, false);
});

test('a value too large for a double is still exact', () => {
  const big = 'ffffffffffffffff';                     // 2^64 - 1
  assert.equal(convertBase(big, 16, 10).value, '18446744073709551615');
  assert.equal(convertBase('18446744073709551615', 10, 16).value, big);
});

test('the base bounds are enforced at both ends', () => {
  assert.equal(convertBase('1', 1, 10).ok, false);
  assert.equal(convertBase('1', 10, 37).ok, false);
  assert.equal(convertBase('1', 2.5, 10).ok, false);
  assert.equal(convertBase('', 10, 2).ok, false);
  assert.equal(convertBase('1', BASE_LIMITS.min, BASE_LIMITS.max).ok, true);
});

/* ============================================================
   UNITS
   ============================================================ */

test('every unit group is well formed', () => {
  assert.ok(UNIT_GROUPS.length >= 8, `only ${UNIT_GROUPS.length} unit categories`);
  for (const group of UNIT_GROUPS) {
    assert.ok(group.id && group.label, 'a unit group is missing its id or label');
    assert.ok(group.units.length >= 4, `${group.id} has only ${group.units.length} units`);
    const codes = new Set();
    for (const [code, label, factor] of group.units) {
      assert.ok(code && label, `${group.id} has a unit missing a code or label`);
      assert.ok(!codes.has(code), `${group.id} declares ${code} twice`);
      codes.add(code);
      if (group.toBase) {
        /* A function-based group must be able to convert every unit it
           lists, in both directions. */
        assert.equal(typeof group.toBase[code], 'function', `${group.id}.${code} has no toBase`);
        assert.equal(typeof group.fromBase[code], 'function', `${group.id}.${code} has no fromBase`);
      } else {
        assert.ok(Number.isFinite(factor) && factor > 0, `${group.id}.${code} has a bad factor`);
      }
    }
    // The declared base unit has to be one of the units.
    assert.ok(codes.has(group.base), `${group.id} claims base "${group.base}", which it does not list`);
  }
});

test('known conversions come out right', () => {
  const near = (got, want, tolerance) =>
    assert.ok(Math.abs(got - want) < (tolerance || 1e-9), `expected ${want}, got ${got}`);

  near(convertUnit(1, 'ft', 'm', 'length').value, 0.3048);
  near(convertUnit(1, 'mi', 'km', 'length').value, 1.609344);
  near(convertUnit(1, 'lb', 'kg', 'mass').value, 0.45359237);
  near(convertUnit(1, 'KiB', 'B', 'data').value, 1024);
  near(convertUnit(1, 'GB', 'MB', 'data').value, 1000);
  near(convertUnit(1, 'h', 'min', 'time').value, 60);
  near(convertUnit(100, 'km/h', 'mph', 'speed').value, 62.1371192, 1e-6);
  near(convertUnit(1, 'ha', 'm2', 'area').value, 10000);
  near(convertUnit(1, 'gal', 'l', 'volume').value, 3.785411784);
  near(convertUnit(180, 'deg', 'rad', 'angle').value, Math.PI, 1e-9);
});

test('temperature converts through offsets, not factors', () => {
  const near = (got, want) => assert.ok(Math.abs(got - want) < 1e-9, `expected ${want}, got ${got}`);
  near(convertUnit(100, 'C', 'F', 'temperature').value, 212);
  near(convertUnit(32, 'F', 'C', 'temperature').value, 0);
  near(convertUnit(0, 'C', 'K', 'temperature').value, 273.15);
  near(convertUnit(-40, 'C', 'F', 'temperature').value, -40, 'the one place the scales cross');
  near(convertUnit(0, 'K', 'R', 'temperature').value, 0);
});

test('every unit round trips against its own group', () => {
  for (const group of UNIT_GROUPS) {
    for (const [code] of group.units) {
      const there = convertUnit(7, group.base, code, group.id);
      const back = convertUnit(there.value, code, group.base, group.id);
      assert.ok(Math.abs(back.value - 7) < 1e-6, `${group.id}: 7 ${group.base} -> ${code} -> ${back.value}`);
    }
  }
});

test('a bad unit or a non-number is refused with a sentence', () => {
  assert.match(convertUnit(1, 'furlong', 'm', 'length').error, /not a length unit/);
  assert.match(convertUnit('abc', 'm', 'ft', 'length').error, /Enter a number/);
  assert.match(convertUnit(1, 'm', 'ft', 'nonsense').error, /Unknown unit category/);
  assert.equal(convertUnit('', 'm', 'ft', 'length').ok, false);
});

test('the whole-group table matches the single conversion', () => {
  const table = unitTable(1, 'm', 'length');
  assert.equal(table.ok, true);
  for (const row of table.rows) {
    const single = convertUnit(1, 'm', row.code, 'length');
    assert.equal(row.value, single.value, `${row.code} disagrees between table and single`);
    assert.equal(typeof row.text, 'string');
  }
  assert.equal(unitTable(1, 'm', 'nope').ok, false);
});

test('quantities are printed as measurements, not as raw doubles', () => {
  assert.equal(formatQuantity(0.1 + 0.2), '0.3', 'float noise must not reach the page');
  assert.equal(formatQuantity(0.3048), '0.3048');
  assert.equal(formatQuantity(0), '0');
  assert.equal(formatQuantity(NaN), '—');
  assert.equal(formatQuantity(Infinity), '—');
  assert.match(formatQuantity(1e-9), /e-0?9$/, 'a nanometre must not round to 0.00');
  assert.match(formatQuantity(1e20), /e\+/);
});

/* ============================================================
   COLOUR
   ============================================================ */

test('every colour notation parses to the same colour', () => {
  const gold = { r: 201, g: 168, b: 76 };
  for (const input of ['#c9a84c', 'c9a84c', '#C9A84C', 'rgb(201, 168, 76)', 'rgb(201 168 76)']) {
    assert.deepEqual(colourFormats(input).rgb, gold, `failed: ${input}`);
  }
  assert.deepEqual(colourFormats('#fff').rgb, { r: 255, g: 255, b: 255 }, 'three-digit hex');
  assert.deepEqual(colourFormats('hsl(0, 100%, 50%)').rgb, { r: 255, g: 0, b: 0 });
});

test('colour output carries every format the page prints', () => {
  const result = colourFormats('#c9a84c');
  const labels = result.rows.map(([label]) => label);
  for (const wanted of ['HEX', 'RGB', 'HSL', 'HSV', 'CMYK']) {
    assert.ok(labels.includes(wanted), `no ${wanted} row`);
  }
  assert.equal(result.hex, '#c9a84c');
});

test('hue survives a trip through RGB and back', () => {
  for (const hue of [0, 45, 120, 200, 280, 359]) {
    const rgb = colourFormats(`hsl(${hue}, 60%, 50%)`).rgb;
    const printed = colourFormats(rgbToHex(rgb)).rows.find(([label]) => label === 'HSL')[1];
    const back = Number(printed.match(/hsl\((-?\d+)/)[1]);
    assert.ok(Math.abs(back - hue) <= 1, `hue ${hue} came back as ${back}`);
  }
});

test('greyscale does not divide by zero', () => {
  for (const grey of ['#000000', '#ffffff', '#808080']) {
    const result = colourFormats(grey);
    assert.equal(result.ok, true);
    assert.match(result.rows.find(([l]) => l === 'HSL')[1], /hsl\(0, 0%/);
  }
  assert.match(colourFormats('#000000').rows.find(([l]) => l === 'CMYK')[1], /100%\)$/);
});

test('contrast ratios match the values the palette is documented in', () => {
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  assert.ok(Math.abs(contrastRatio(white, black) - 21) < 0.01, 'black on white is 21:1 by definition');
  assert.equal(contrastRatio(white, white).toFixed(2), '1.00');
  assert.ok(contrastRatio({ r: 201, g: 168, b: 76 }, black) > 4.5, 'the brand gold clears AA on black');
});

test('a colour that cannot be read is explained, not guessed', () => {
  for (const bad of ['', 'not a colour', '#12', 'rgb(1,2)', 'hsl(1)', '#gggggg']) {
    const result = colourFormats(bad);
    assert.equal(result.ok, false, `accepted: ${bad}`);
    assert.ok(result.error.length > 5);
  }
});

test('out-of-range channels are clamped rather than wrapping', () => {
  assert.deepEqual(colourFormats('rgb(300, -20, 128)').rgb, { r: 255, g: 0, b: 128 });
});

/* ============================================================
   TIME
   ============================================================ */

test('epoch seconds and milliseconds are both understood', () => {
  const seconds = timeFormats('1786000000');
  const millis = timeFormats('1786000000000');
  const value = rows => rows.find(([label]) => label === 'ISO 8601 (UTC)')[1];
  assert.equal(value(seconds.rows), value(millis.rows), 'the same instant either way');
  assert.equal(seconds.rows.find(([l]) => l === 'Unix seconds')[1], '1786000000');
  assert.equal(seconds.rows.find(([l]) => l === 'Unix milliseconds')[1], '1786000000000');
});

test('the epoch itself and dates before it still work', () => {
  assert.equal(timeFormats('0').rows.find(([l]) => l === 'ISO 8601 (UTC)')[1], '1970-01-01T00:00:00.000Z');
  assert.equal(timeFormats('-86400').ok, true, 'a negative epoch is a real date');
});

test('a written date is accepted and reported in every format', () => {
  const result = timeFormats('2026-08-09T12:00:00Z');
  assert.equal(result.ok, true);
  const labels = result.rows.map(([label]) => label);
  for (const wanted of ['Unix seconds', 'ISO 8601 (UTC)', 'ISO 8601 (local)', 'RFC 1123 (UTC)']) {
    assert.ok(labels.includes(wanted), `no ${wanted} row`);
  }
  assert.equal(result.rows.find(([l]) => l === 'Date only (UTC)')[1], '2026-08-09');
});

test('the local ISO line carries a real offset', () => {
  const local = timeFormats('1786000000').rows.find(([l]) => l === 'ISO 8601 (local)')[1];
  assert.match(local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    'a bare local time with the zone dropped is the bug this line exists to avoid');
});

test('an unreadable time is explained rather than rendering Invalid Date', () => {
  for (const bad of ['', '   ', 'sometime tuesday', '99999999999999999999999']) {
    const result = timeFormats(bad);
    assert.equal(result.ok, false, `accepted: ${bad}`);
    assert.doesNotMatch(result.error, /Invalid Date/);
  }
});
