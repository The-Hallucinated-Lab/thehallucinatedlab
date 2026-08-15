/**
 * Dictionary search engine.
 *
 * A corpus-agnostic client-side engine implementing Series 700 of the Master
 * Lexicographical Framework. It is handed a generated index and knows nothing
 * about which sections exist, what the LID prefixes are, or which terms are in
 * the corpus.
 *
 * Rule map:
 *   701-705  normalize()            case-folding, diacritics, punctuation, stop words
 *   706-707  damerauLevenshtein()   edit distance with transposition
 *   708      metaphone()            phonetic fallback
 *   709      keyProximity()         QWERTY-weighted substitution cost
 *   710-712  SearchEngine#build()   inverted index over multiple fields
 *   711      edge n-grams           prefix retrieval for auto-complete
 *   713      lemma routing          inflected forms resolve to their headword
 *   714-719  scoring tiers          10x / 8x / 5x / 1x, frequency tie-break, archaic penalty
 *   720-722  parseQuery()           wildcards, exact phrases, boolean operators
 *   725      search({limit,offset}) pagination
 */

/* ------------------------------------------------------------------ *
 * Series 70.A — query pre-processing and normalization
 * ------------------------------------------------------------------ */

/** Rule 705. Ignored inside polygram queries, honoured in unigram queries. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'is', 'are', 'was',
  'were', 'be', 'by', 'with', 'and', 'or', 'as', 'that', 'this', 'it', 'its'
]);

const BOOLEAN_OPERATORS = new Set(['AND', 'OR', 'NOT']);

/**
 * Rules 701-704. Lowercase, strip diacritics, flatten punctuation to spaces,
 * collapse whitespace. Applied identically to queries and to indexed text so
 * both sides of a comparison live in the same space.
 */
export function normalize(input) {
  if (!input) return '';
  return String(input)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2010-\u2015]/g, ' ')
    .replace(/[^a-z0-9*?\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text) {
  const normalized = normalize(text);
  return normalized ? normalized.split(' ') : [];
}

/* ------------------------------------------------------------------ *
 * Series 70.B — fuzzy matching and typo tolerance
 * ------------------------------------------------------------------ */

const QWERTY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const KEY_POSITIONS = (() => {
  const map = new Map();
  QWERTY_ROWS.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      // Rows are physically offset by roughly half a key.
      map.set(row[x], { x: x + y * 0.5, y });
    }
  });
  return map;
})();

/**
 * Rule 709. A substitution between adjacent keys is a probable typo and costs
 * less than one between distant keys. Returns a cost in [0.5, 1].
 */
export function keyProximity(a, b) {
  if (a === b) return 0;
  const pa = KEY_POSITIONS.get(a);
  const pb = KEY_POSITIONS.get(b);
  if (!pa || !pb) return 1;
  const distance = Math.hypot(pa.x - pb.x, pa.y - pb.y);
  return distance <= 1.2 ? 0.5 : 1;
}

/**
 * Rules 706-707. Damerau-Levenshtein with QWERTY-weighted substitutions.
 * `ceiling` short-circuits the computation once the best possible remaining
 * distance already exceeds what the caller would accept.
 */
export function damerauLevenshtein(a, b, ceiling = Infinity) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > ceiling) return ceiling + 1;

  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);

  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array(b.length + 1);
    current[0] = i;
    let rowMin = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost =
        a[i - 1] === b[j - 1] ? 0 : keyProximity(a[i - 1], b[j - 1]);

      let best = Math.min(
        current[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + substitutionCost
      );

      // Transposition of adjacent characters — the most common typing error.
      if (
        i > 1 && j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        best = Math.min(best, prev2[j - 2] + 1);
      }

      current[j] = best;
      if (best < rowMin) rowMin = best;
    }

    if (rowMin > ceiling) return ceiling + 1;
    prev2 = prev;
    prev = current;
  }

  return prev[b.length];
}

/** Rule 706. Edit budget scales with word length. */
export function editBudget(length) {
  if (length < 5) return 1;
  if (length < 10) return 2;
  return 3;
}

/**
 * Rule 708. A compact Metaphone variant — enough to route "flem" to "phlegm"
 * and "nemonia" to "pneumonia" without shipping a full phonetic library.
 */
export function metaphone(word) {
  let w = normalize(word).replace(/[^a-z]/g, '');
  if (!w) return '';

  // Silent leading clusters.
  w = w
    .replace(/^(kn|gn|pn|ae|wr)/, (m) => m[1])
    .replace(/^x/, 's')
    .replace(/^wh/, 'w');

  let out = '';
  for (let i = 0; i < w.length; i += 1) {
    const c = w[i];
    const next = w[i + 1] || '';
    const prev = w[i - 1] || '';
    if (c === prev && c !== 'c') continue; // collapse doubles

    switch (c) {
      case 'a': case 'e': case 'i': case 'o': case 'u':
        if (i === 0) out += c;
        break;
      case 'b':
        if (!(i === w.length - 1 && prev === 'm')) out += 'b';
        break;
      case 'c':
        if (next === 'i' && w[i + 2] === 'a') out += 'x';
        else if (next === 'h') { out += 'x'; i += 1; }
        else if ('iey'.includes(next)) out += 's';
        else out += 'k';
        break;
      case 'd':
        if (next === 'g' && 'iey'.includes(w[i + 2] || '')) { out += 'j'; i += 1; }
        else out += 't';
        break;
      case 'g':
        if (next === 'h') { if (!'aeiou'.includes(w[i + 2] || '')) i += 1; else { out += 'k'; i += 1; } }
        else if (next === 'n') { /* silent */ }
        else if ('iey'.includes(next)) out += 'j';
        else out += 'k';
        break;
      case 'h':
        if ('aeiou'.includes(prev) && !'aeiou'.includes(next)) break;
        out += 'h';
        break;
      case 'k':
        if (prev !== 'c') out += 'k';
        break;
      case 'p':
        if (next === 'h') { out += 'f'; i += 1; } else out += 'p';
        break;
      case 'q': out += 'k'; break;
      case 's':
        if (next === 'h') { out += 'x'; i += 1; }
        else if (next === 'i' && 'oa'.includes(w[i + 2] || '')) out += 'x';
        else out += 's';
        break;
      case 't':
        if (next === 'h') { out += '0'; i += 1; }
        else if (next === 'i' && 'oa'.includes(w[i + 2] || '')) out += 'x';
        else out += 't';
        break;
      case 'v': out += 'f'; break;
      case 'w': case 'y':
        if ('aeiou'.includes(next)) out += c;
        break;
      case 'x': out += 'ks'; break;
      case 'z': out += 's'; break;
      default: out += c;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Series 70.E — advanced query modifiers
 * ------------------------------------------------------------------ */

/**
 * Rules 720-722. Splits raw user input into a structured query.
 *
 *   "kick the bucket"       -> exact phrase, fuzzy and phonetics disabled
 *   *ology                  -> wildcard
 *   loss AND gradient       -> boolean
 *   tensor NOT physics      -> boolean with exclusion
 */
export function parseQuery(raw) {
  const query = {
    raw: String(raw || '').trim(),
    phrases: [],
    terms: [],
    excluded: [],
    wildcards: [],
    mode: 'OR',
    exact: false
  };
  if (!query.raw) return query;

  // Exact phrases first — everything inside quotes bypasses later processing.
  const remainder = query.raw.replace(/"([^"]+)"/g, (_, phrase) => {
    query.phrases.push(normalize(phrase));
    query.exact = true;
    return ' ';
  });

  const rawTokens = remainder.split(/\s+/).filter(Boolean);
  let negateNext = false;

  for (const token of rawTokens) {
    if (BOOLEAN_OPERATORS.has(token)) {
      if (token === 'NOT') negateNext = true;
      else query.mode = token;
      continue;
    }

    const cleaned = normalize(token);
    if (!cleaned) continue;

    if (negateNext) {
      query.excluded.push(cleaned);
      negateNext = false;
      continue;
    }

    if (cleaned.includes('*') || cleaned.includes('?')) {
      query.wildcards.push(wildcardToRegExp(cleaned));
      continue;
    }

    query.terms.push(cleaned);
  }

  // Rule 705: stop words are literal in a unigram query, dropped in a polygram.
  if (query.terms.length > 2) {
    const kept = query.terms.filter((t) => !STOP_WORDS.has(t));
    if (kept.length) query.terms = kept;
  }

  return query;
}

/** Rule 720. `*` is zero or more characters, `?` is exactly one. */
function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}

/* ------------------------------------------------------------------ *
 * Scoring weights — Series 70.D
 * ------------------------------------------------------------------ */

const WEIGHT = {
  headwordExact: 10,   // Rule 714
  inflectedExact: 8,   // Rule 715
  abbreviation: 8,
  headwordPrefix: 6.5,
  anchorToken: 5,      // Rule 716
  synonym: 3,
  fuzzy: 4,
  phonetic: 2.5,
  definition: 1        // Rule 717
};

const ARCHAIC_FLAGS = new Set(['Archaic', 'Obsolete', 'Rare']);

/* ------------------------------------------------------------------ *
 * The engine — Series 70.C
 * ------------------------------------------------------------------ */

export class SearchEngine {
  /**
   * @param {{entries: Array<object>}} index  the generated search index
   */
  constructor(index) {
    this.entries = index.entries || [];
    this.sections = index.sections || {};
    this.byHeadword = new Map();   // normalized headword -> [entry]
    this.byAlias = new Map();      // inflection/variant/abbr -> [entry]
    this.byToken = new Map();      // Rule 710: inverted index, token -> Set(entry)
    this.byPhonetic = new Map();   // Rule 708
    this.byEdgeNgram = new Map();  // Rule 711
    this.vocabulary = new Set();   // fuzzy-match candidate pool
    this.build();
  }

  build() {
    for (const entry of this.entries) {
      const headword = normalize(entry.term);
      entry._headword = headword;
      entry._tokens = headword.split(' ');

      push(this.byHeadword, headword, entry);
      this.vocabulary.add(headword);
      // Index the phonetic key of the whole headword and of each token, so a
      // one-word sound-alike query can still reach a multi-word entry.
      for (const form of new Set([headword, ...entry._tokens])) {
        addTo(this.byPhonetic, metaphone(form), entry);
      }

      // Rule 711: edge n-grams over the headword and each of its tokens, so a
      // three-keystroke prefix retrieves without scanning the corpus.
      for (const token of new Set([headword, ...entry._tokens])) {
        for (let n = 1; n <= Math.min(token.length, 24); n += 1) {
          addTo(this.byEdgeNgram, token.slice(0, n), entry);
        }
      }

      // Rule 713: inflected forms, variants and abbreviations route to the lemma.
      const aliases = [
        ...(entry.inflections || []),
        ...(entry.variants || []),
        ...(entry.abbr || [])
      ];
      for (const alias of aliases) {
        const key = normalize(alias);
        if (!key) continue;
        push(this.byAlias, key, entry);
        this.vocabulary.add(key);
        addTo(this.byPhonetic, metaphone(key), entry);
        for (let n = 1; n <= Math.min(key.length, 24); n += 1) {
          addTo(this.byEdgeNgram, key.slice(0, n), entry);
        }
      }

      // Rule 712: the inverted index spans headword, synonyms and definition text.
      const searchable = [
        headword,
        ...aliases.map(normalize),
        ...(entry.synonyms || []).map(normalize),
        normalize(entry.defText || entry.gloss || '')
      ].join(' ');

      for (const token of new Set(searchable.split(' ').filter(Boolean))) {
        addTo(this.byToken, token, entry);
        if (token.length > 2) this.vocabulary.add(token);
      }
    }
  }

  /* ---------------- auto-complete ---------------- */

  /**
   * Rule 602/711. Prefix retrieval for the suggestion dropdown. The caller is
   * responsible for the 3-keystroke threshold and the 150ms debounce.
   */
  suggest(rawQuery, { scope = 'all', limit = 8 } = {}) {
    const prefix = normalize(rawQuery);
    if (!prefix) return [];

    const candidates = this.byEdgeNgram.get(prefix) || [];
    const scored = [];

    for (const entry of candidates) {
      if (!inScope(entry, scope)) continue;
      const isHeadwordPrefix = entry._headword.startsWith(prefix);
      scored.push({
        entry,
        score:
          (entry._headword === prefix ? WEIGHT.headwordExact
            : isHeadwordPrefix ? WEIGHT.headwordPrefix
              : WEIGHT.anchorToken) + entry.frequency / 1000
      });
    }

    if (!scored.length) return this.search(rawQuery, { scope, limit }).results;

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => ({ ...s.entry, _score: s.score }));
  }

  /* ---------------- full search ---------------- */

  /**
   * @returns {{results: Array, total: number, suggestion: ?string, query: object}}
   */
  search(rawQuery, { scope = 'all', limit = 20, offset = 0 } = {}) {
    const query = parseQuery(rawQuery);
    const empty = { results: [], total: 0, suggestion: null, query };
    if (!query.raw) return empty;

    const scores = new Map();
    const add = (entry, points, reason) => {
      if (!inScope(entry, scope)) return;
      const current = scores.get(entry) || { points: 0, reasons: [] };
      current.points += points;
      if (reason && !current.reasons.includes(reason)) current.reasons.push(reason);
      scores.set(entry, current);
    };

    // Rule 721 — an exact phrase bypasses fuzzy matching and phonetics entirely.
    for (const phrase of query.phrases) {
      for (const entry of this.byHeadword.get(phrase) || []) {
        add(entry, WEIGHT.headwordExact, 'exact phrase');
      }
      for (const entry of this.byAlias.get(phrase) || []) {
        add(entry, WEIGHT.inflectedExact, 'exact phrase');
      }
      for (const entry of this.entries) {
        if (normalize(entry.defText || '').includes(phrase)) {
          add(entry, WEIGHT.definition, 'phrase in definition');
        }
      }
    }

    // Rule 720 — wildcards run against headwords and aliases only.
    for (const pattern of query.wildcards) {
      for (const [headword, entries] of this.byHeadword) {
        if (pattern.test(headword)) entries.forEach((e) => add(e, WEIGHT.headwordExact, 'wildcard'));
      }
      for (const [alias, entries] of this.byAlias) {
        if (pattern.test(alias)) entries.forEach((e) => add(e, WEIGHT.inflectedExact, 'wildcard'));
      }
    }

    const wholeQuery = query.terms.join(' ');

    // The whole query as a single headword — the strongest possible signal.
    if (wholeQuery) {
      for (const entry of this.byHeadword.get(wholeQuery) || []) {
        add(entry, WEIGHT.headwordExact, 'exact match');
      }
      for (const entry of this.byAlias.get(wholeQuery) || []) {
        add(entry, WEIGHT.inflectedExact, 'inflected form');
      }
    }

    for (const term of query.terms) {
      // Tier 1-2.
      (this.byHeadword.get(term) || []).forEach((e) => add(e, WEIGHT.headwordExact, 'exact match'));
      (this.byAlias.get(term) || []).forEach((e) => add(e, WEIGHT.inflectedExact, 'inflected form'));

      // Prefix.
      for (const entry of this.byEdgeNgram.get(term) || []) {
        if (entry._headword.startsWith(term) && entry._headword !== term) {
          add(entry, WEIGHT.headwordPrefix, 'prefix');
        }
      }

      // Tier 3 — Rule 716: the query is an anchor word inside a multi-word term.
      for (const entry of this.byToken.get(term) || []) {
        if (entry._tokens.includes(term) && entry._tokens.length > 1) {
          add(entry, WEIGHT.anchorToken, 'anchor term');
        } else if ((entry.synonyms || []).some((s) => normalize(s) === term)) {
          add(entry, WEIGHT.synonym, 'synonym');
        } else {
          // Tier 4 — Rule 717: deep search into definition text.
          add(entry, WEIGHT.definition, 'in definition');
        }
      }
    }

    // Fuzzy and phonetic fallbacks, skipped for exact-phrase queries (Rule 721).
    let suggestion = null;
    if (!query.exact && scores.size < 5) {
      for (const term of query.terms) {
        const budget = editBudget(term.length);
        let bestWord = null;
        let bestDistance = Infinity;

        for (const word of this.vocabulary) {
          if (Math.abs(word.length - term.length) > budget) continue;
          const distance = damerauLevenshtein(term, word, budget);
          if (distance > budget) continue;
          const points = WEIGHT.fuzzy * (1 - distance / (budget + 1));
          (this.byHeadword.get(word) || []).forEach((e) => add(e, points, 'fuzzy match'));
          (this.byAlias.get(word) || []).forEach((e) => add(e, points * 0.8, 'fuzzy match'));
          if (distance < bestDistance) {
            bestDistance = distance;
            bestWord = word;
          }
        }

        // Rule 708 — phonetic fallback only when nothing else landed.
        if (!scores.size) {
          for (const entry of this.byPhonetic.get(metaphone(term)) || []) {
            add(entry, WEIGHT.phonetic, 'sounds like');
            if (!bestWord) bestWord = entry._headword;
          }
        }

        // Rule 601 — "did you mean", offered only when the query itself missed.
        if (bestWord && bestWord !== term && !this.byHeadword.has(term)) {
          suggestion = bestWord;
        }
      }
    }

    // Rule 722 — NOT excludes, AND requires every term to have contributed.
    const ranked = [];
    for (const [entry, score] of scores) {
      const haystack = `${entry._headword} ${normalize(entry.defText || '')}`;
      if (query.excluded.some((term) => haystack.includes(term))) continue;
      if (query.mode === 'AND' && query.terms.length > 1) {
        const matchesAll = query.terms.every((term) => haystack.includes(term));
        if (!matchesAll) continue;
      }

      // Rule 719 — obsolete terms must not outrank live ones on a fuzzy hit.
      const archaic = (entry.flags || []).some((f) => ARCHAIC_FLAGS.has(f));
      const penalty = archaic ? 0.5 : 1;

      ranked.push({
        ...entry,
        // Rule 718 — corpus frequency breaks ties without overturning tiers.
        _score: score.points * penalty + (entry.frequency || 0) / 1000,
        _reasons: score.reasons
      });
    }

    ranked.sort((a, b) => b._score - a._score || a.term.localeCompare(b.term));

    // Rule 725 — cap the payload; the caller pages through the remainder.
    return {
      results: ranked.slice(offset, offset + limit),
      total: ranked.length,
      suggestion,
      query
    };
  }
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function inScope(entry, scope) {
  return scope === 'all' || entry.section === scope;
}

/** Ordered bucket. Homographs deliberately share a key here (Rule 105). */
function push(map, key, value) {
  if (!key) return;
  let bucket = map.get(key);
  if (!bucket) {
    bucket = [];
    map.set(key, bucket);
  }
  bucket.push(value);
}

/**
 * Set-backed bucket for the derived indexes.
 *
 * One entry reaches the same key by several routes — "gra" is a prefix of the
 * headword "gradient descent", of its token "gradient", and of the inflection
 * "gradient descents". As an array that entry appears three times, which shows
 * up as a triplicated suggestion and, worse, triples its score during ranking
 * because points accumulate per occurrence.
 */
function addTo(map, key, value) {
  if (!key) return;
  let bucket = map.get(key);
  if (!bucket) {
    bucket = new Set();
    map.set(key, bucket);
  }
  bucket.add(value);
}
