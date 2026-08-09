/* ============================================================
   convert-scales.js — the measurement converters on the Converters
   page: number bases, physical units, colour spaces and timestamps.

   Split out of converters.js because that file was 53 KB against a 40 KB
   per-page script budget, and the split is along a real seam rather than
   an arbitrary byte count: everything here converts a *quantity*, where
   the text converters convert a *document*.

   The seam has one rule that keeps the two files independent, and it is
   worth knowing before editing either. Nothing here throws. Every entry
   point returns { ok: true, ... } or { ok: false, error } with a sentence
   the visitor can act on. That means this file shares no error class, no
   helper and no global with converters.js — the two scripts load into the
   same global scope, so a second definition of anything would be a
   collision, and a `const` collision is an outright SyntaxError that
   takes the whole page with it.

   It also satisfies the standing rule about never rendering a raw
   exception message: the classification happens here, at the boundary,
   rather than in a catch block in the UI.
   ============================================================ */

/* @pure-start — free of DOM, storage and network. Loaded directly by
   test/converters.test.js. */

/* ============ SHARED NUMERICS ============ */
function clampScale(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/* A converted quantity is a measurement, not a float. Printing the raw
   double gives 0.30000000000000004 metres for a foot; rounding to fixed
   decimals turns a nanometre into 0.00. Significant figures are the only
   thing that is right at both ends of the scale. */
function formatQuantity(value, significant) {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e15 || magnitude < 1e-6) {
    return value.toExponential(6).replace(/e([+-])(\d)$/, 'e$10$2');
  }
  return String(Number(value.toPrecision(significant || 12)));
}

/* ============ NUMBER BASES ============ */
const BASE_LIMITS = { min: 2, max: 36 };
const BASE_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function convertBase(value, fromBase, toBase) {
  const from = Number(fromBase);
  const to = Number(toBase);
  for (const [name, base] of [['source', from], ['target', to]]) {
    if (!Number.isInteger(base) || base < BASE_LIMITS.min || base > BASE_LIMITS.max) {
      return { ok: false, error: `The ${name} base must be a whole number from ${BASE_LIMITS.min} to ${BASE_LIMITS.max}.` };
    }
  }

  const raw = String(value == null ? '' : value).trim().replace(/^0[bxo]/i, '').replace(/[\s_]/g, '');
  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).toLowerCase();
  if (!digits) return { ok: false, error: 'Enter a number first.' };

  /* parseInt would stop at the first illegal digit and return whatever it
     had: "1092" read as binary becomes 1, silently. BigInt because a
     64-bit hex value is a completely ordinary thing to paste here and a
     double would round it. */
  let total = 0n;
  const bigFrom = BigInt(from);
  for (const ch of digits) {
    const digit = parseInt(ch, 36);
    if (Number.isNaN(digit) || digit >= from) {
      return { ok: false, error: `"${ch}" is not a digit in base ${from}.` };
    }
    total = total * bigFrom + BigInt(digit);
  }

  if (total === 0n) return { ok: true, value: '0' };
  const bigTo = BigInt(to);
  let out = '';
  let n = total;
  while (n > 0n) {
    out = BASE_ALPHABET[Number(n % bigTo)] + out;
    n /= bigTo;
  }
  return { ok: true, value: (negative ? '-' : '') + out };
}

/* ============ UNITS ============
   Factors are to the group's base unit, so every pair is one
   multiplication and one division and there is no N-squared table to
   keep consistent. Temperature is the exception: its scales have
   offsets, so it carries functions instead of factors.

   Where a unit is ambiguous in the real world the label says which one
   it is — a US gallon is not a UK gallon, and a "month" is only 30 days
   because something has to be chosen. */
const UNIT_GROUPS = [
  {
    id: 'length', label: 'Length', base: 'm',
    units: [
      ['nm', 'nanometre', 1e-9], ['um', 'micrometre', 1e-6], ['mm', 'millimetre', 0.001],
      ['cm', 'centimetre', 0.01], ['m', 'metre', 1], ['km', 'kilometre', 1000],
      ['in', 'inch', 0.0254], ['ft', 'foot', 0.3048], ['yd', 'yard', 0.9144],
      ['mi', 'mile', 1609.344], ['nmi', 'nautical mile', 1852],
    ],
  },
  {
    id: 'mass', label: 'Mass', base: 'kg',
    units: [
      ['mg', 'milligram', 1e-6], ['g', 'gram', 0.001], ['kg', 'kilogram', 1], ['t', 'tonne', 1000],
      ['oz', 'ounce', 0.0283495231], ['lb', 'pound', 0.45359237], ['st', 'stone', 6.35029318],
      ['ton_us', 'short ton (US)', 907.18474], ['ton_uk', 'long ton (UK)', 1016.0469088],
    ],
  },
  {
    id: 'data', label: 'Data', base: 'B',
    units: [
      ['bit', 'bit', 0.125], ['B', 'byte', 1],
      ['KB', 'kilobyte (1000)', 1e3], ['MB', 'megabyte (1000)', 1e6],
      ['GB', 'gigabyte (1000)', 1e9], ['TB', 'terabyte (1000)', 1e12],
      ['KiB', 'kibibyte (1024)', 1024], ['MiB', 'mebibyte (1024)', 1048576],
      ['GiB', 'gibibyte (1024)', 1073741824], ['TiB', 'tebibyte (1024)', 1099511627776],
    ],
  },
  {
    id: 'time', label: 'Time', base: 's',
    units: [
      ['ms', 'millisecond', 0.001], ['s', 'second', 1], ['min', 'minute', 60], ['h', 'hour', 3600],
      ['d', 'day', 86400], ['wk', 'week', 604800], ['mo', 'month (30 d)', 2592000], ['yr', 'year (365 d)', 31536000],
    ],
  },
  {
    id: 'speed', label: 'Speed', base: 'm/s',
    units: [
      ['m/s', 'metres per second', 1], ['km/h', 'kilometres per hour', 0.277777778],
      ['mph', 'miles per hour', 0.44704], ['kn', 'knot', 0.514444444], ['ft/s', 'feet per second', 0.3048],
    ],
  },
  {
    id: 'area', label: 'Area', base: 'm2',
    units: [
      ['mm2', 'square millimetre', 1e-6], ['cm2', 'square centimetre', 1e-4], ['m2', 'square metre', 1],
      ['ha', 'hectare', 1e4], ['km2', 'square kilometre', 1e6],
      ['in2', 'square inch', 0.00064516], ['ft2', 'square foot', 0.09290304],
      ['ac', 'acre', 4046.8564224], ['mi2', 'square mile', 2589988.110336],
    ],
  },
  {
    id: 'volume', label: 'Volume', base: 'l',
    units: [
      ['ml', 'millilitre', 0.001], ['cl', 'centilitre', 0.01], ['l', 'litre', 1], ['m3', 'cubic metre', 1000],
      ['tsp', 'teaspoon (US)', 0.00492892159], ['tbsp', 'tablespoon (US)', 0.0147867648],
      ['cup', 'cup (US)', 0.2365882365], ['pt', 'pint (US)', 0.473176473],
      ['qt', 'quart (US)', 0.946352946], ['gal', 'gallon (US)', 3.785411784], ['gal_uk', 'gallon (UK)', 4.54609],
    ],
  },
  {
    id: 'angle', label: 'Angle', base: 'deg',
    units: [
      ['deg', 'degree', 1], ['rad', 'radian', 57.2957795130823], ['grad', 'gradian', 0.9],
      ['turn', 'turn', 360], ['arcmin', 'arcminute', 1 / 60], ['arcsec', 'arcsecond', 1 / 3600],
    ],
  },
  {
    id: 'temperature', label: 'Temperature', base: 'C',
    units: [['C', 'Celsius', null], ['F', 'Fahrenheit', null], ['K', 'kelvin', null], ['R', 'Rankine', null]],
    toBase: { C: v => v, F: v => (v - 32) / 1.8, K: v => v - 273.15, R: v => (v - 491.67) / 1.8 },
    fromBase: { C: v => v, F: v => v * 1.8 + 32, K: v => v + 273.15, R: v => (v + 273.15) * 1.8 },
  },
];

function unitGroupById(id) {
  return UNIT_GROUPS.find(g => g.id === id) || null;
}

function unitEntry(group, code) {
  return group.units.find(u => u[0] === code) || null;
}

function convertUnit(value, fromCode, toCode, groupId) {
  const group = unitGroupById(groupId);
  if (!group) return { ok: false, error: `Unknown unit category "${groupId}".` };

  /* Number('') is 0, not NaN, so an empty input box would otherwise
     convert cleanly and print "0 ft" as though it had been asked to. */
  const raw = String(value == null ? '' : value).trim();
  const amount = Number(raw);
  if (!raw || !Number.isFinite(amount)) return { ok: false, error: 'Enter a number to convert.' };

  for (const code of [fromCode, toCode]) {
    if (!unitEntry(group, code)) {
      return { ok: false, error: `"${code}" is not a ${group.label.toLowerCase()} unit.` };
    }
  }

  if (group.toBase) {
    return { ok: true, value: group.fromBase[toCode](group.toBase[fromCode](amount)) };
  }
  return { ok: true, value: (amount * unitEntry(group, fromCode)[2]) / unitEntry(group, toCode)[2] };
}

/* Every unit in the group at once. The question after "how many feet is
   1.8 m" is almost always the same value in a third unit. */
function unitTable(value, fromCode, groupId) {
  const group = unitGroupById(groupId);
  if (!group) return { ok: false, error: `Unknown unit category "${groupId}".` };
  const rows = [];
  for (const [code, label] of group.units) {
    const result = convertUnit(value, fromCode, code, groupId);
    if (!result.ok) return result;
    rows.push({ code, label, value: result.value, text: formatQuantity(result.value) });
  }
  return { ok: true, rows };
}

/* ============ COLOUR ============ */
function parseColour(input) {
  const text = String(input == null ? '' : input).trim().toLowerCase();
  if (!text) return { ok: false, error: 'Enter a colour first.' };

  const hex = text.replace(/^#/, '');
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return { ok: true, rgb: { r: parseInt(hex[0] + hex[0], 16), g: parseInt(hex[1] + hex[1], 16), b: parseInt(hex[2] + hex[2], 16) } };
  }
  if (/^[0-9a-f]{6}$/.test(hex)) {
    return { ok: true, rgb: { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) } };
  }

  const rgbMatch = text.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some(n => !Number.isFinite(n))) {
      return { ok: false, error: 'That rgb() is missing a channel.' };
    }
    return {
      ok: true,
      rgb: {
        r: clampScale(Math.round(parts[0]), 0, 255),
        g: clampScale(Math.round(parts[1]), 0, 255),
        b: clampScale(Math.round(parts[2]), 0, 255),
      },
    };
  }

  const hslMatch = text.match(/^hsla?\(([^)]+)\)$/);
  if (hslMatch) {
    const parts = hslMatch[1].split(/[,/\s]+/).filter(Boolean)
      .map(p => Number(String(p).replace('%', '').replace('deg', '')));
    if (parts.length < 3 || parts.slice(0, 3).some(n => !Number.isFinite(n))) {
      return { ok: false, error: 'That hsl() is missing a component.' };
    }
    return { ok: true, rgb: hslToRgb(parts[0], parts[1], parts[2]) };
  }

  return { ok: false, error: 'Use a hex like #c9a84c, or rgb(201, 168, 76), or hsl(45, 45%, 54%).' };
}

function hslToRgb(h, s, l) {
  const hue = ((Number(h) % 360) + 360) % 360;
  const sat = clampScale(Number(s), 0, 100) / 100;
  const lig = clampScale(Number(l), 0, 100) / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;
  const sextant = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hue / 60) % 6];
  return {
    r: Math.round((sextant[0] + m) * 255),
    g: Math.round((sextant[1] + m) * 255),
    b: Math.round((sextant[2] + m) * 255),
  };
}

function rgbToHsl(rgb) {
  const [rr, gg, bb] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  let h;
  if (max === rr) h = ((gg - bb) / d) % 6;
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return { h: (((h * 60) % 360) + 360) % 360, s: (d / (1 - Math.abs(2 * l - 1))) * 100, l: l * 100 };
}

function rgbToHsv(rgb) {
  const [rr, gg, bb] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  const max = Math.max(rr, gg, bb);
  const d = max - Math.min(rr, gg, bb);
  return { h: rgbToHsl(rgb).h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
}

function rgbToCmyk(rgb) {
  const [rr, gg, bb] = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  const k = 1 - Math.max(rr, gg, bb);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: ((1 - rr - k) / (1 - k)) * 100,
    m: ((1 - gg - k) / (1 - k)) * 100,
    y: ((1 - bb - k) / (1 - k)) * 100,
    k: k * 100,
  };
}

function rgbToHex(rgb) {
  return `#${[rgb.r, rgb.g, rgb.b].map(n => clampScale(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

/* The two numbers that decide whether a colour can carry text. Included
   because this site's own palette is documented in contrast ratios, and
   a colour tool that cannot answer "is this readable" is decoration. */
function relativeLuminance(rgb) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function colourFormats(input) {
  const parsed = parseColour(input);
  if (!parsed.ok) return parsed;
  const { rgb } = parsed;
  const hsl = rgbToHsl(rgb);
  const hsv = rgbToHsv(rgb);
  const cmyk = rgbToCmyk(rgb);
  const r = Math.round;
  return {
    ok: true,
    rgb,
    hex: rgbToHex(rgb),
    rows: [
      ['HEX', rgbToHex(rgb)],
      ['RGB', `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`],
      ['HSL', `hsl(${r(hsl.h)}, ${r(hsl.s)}%, ${r(hsl.l)}%)`],
      ['HSV', `hsv(${r(hsv.h)}, ${r(hsv.s)}%, ${r(hsv.v)}%)`],
      ['CMYK', `cmyk(${r(cmyk.c)}%, ${r(cmyk.m)}%, ${r(cmyk.y)}%, ${r(cmyk.k)}%)`],
      ['Contrast on white', `${contrastRatio(rgb, { r: 255, g: 255, b: 255 }).toFixed(2)}:1`],
      ['Contrast on black', `${contrastRatio(rgb, { r: 0, g: 0, b: 0 }).toFixed(2)}:1`],
    ],
  };
}

/* ============ TIME ============ */
function parseWhen(input) {
  const text = String(input == null ? '' : input).trim();
  if (!text) return { ok: false, error: 'Enter a timestamp or a date first.' };

  if (/^-?\d{1,19}$/.test(text)) {
    const n = Number(text);
    /* Seconds or milliseconds, decided by magnitude rather than by digit
       count, so 0 and negative epochs still work. 1e11 seconds is the
       year 5138 — anything larger was meant as milliseconds. */
    const date = new Date(Math.abs(n) < 1e11 ? n * 1000 : n);
    if (Number.isNaN(date.getTime())) return { ok: false, error: 'That number is outside the range of a date.' };
    return { ok: true, date };
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: 'That is not a date this browser recognises. Try 2026-08-09, or an epoch like 1786000000.' };
  }
  return { ok: true, date };
}

function timeFormats(input) {
  const parsed = parseWhen(input);
  if (!parsed.ok) return parsed;
  const { date } = parsed;
  const ms = date.getTime();
  const pad = (n, w) => String(Math.abs(n)).padStart(w || 2, '0');
  /* getTimezoneOffset is minutes *behind* UTC, so the sign is inverted
     from the one an ISO string carries. */
  const offsetMin = -date.getTimezoneOffset();
  const offset = `${offsetMin < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`;

  return {
    ok: true,
    rows: [
      ['Unix seconds', String(Math.floor(ms / 1000))],
      ['Unix milliseconds', String(ms)],
      ['ISO 8601 (UTC)', date.toISOString()],
      ['ISO 8601 (local)', `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`],
      ['RFC 1123 (UTC)', date.toUTCString()],
      ['Date only (UTC)', date.toISOString().slice(0, 10)],
      ['This browser', `UTC${offset}`],
    ],
  };
}

/* @pure-end */

/* Published on the site's single THL namespace, the same way
   eda-engine.js publishes its engine, so converters-ui.js has one name to
   reach for instead of nine bare globals. */
window.THL = window.THL || {};
window.THL.scales = {
  BASE_LIMITS: BASE_LIMITS,
  UNIT_GROUPS: UNIT_GROUPS,
  convertBase: convertBase,
  convertUnit: convertUnit,
  unitTable: unitTable,
  colourFormats: colourFormats,
  rgbToHex: rgbToHex,
  timeFormats: timeFormats,
  formatQuantity: formatQuantity,
};
