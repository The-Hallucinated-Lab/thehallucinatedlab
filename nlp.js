/* ============================================================
   nlp.js — intent parser for THL tools.

   Turns "make it a jpg at 80 quality" into
   { tool: 'converter', args: { format: 'jpeg', quality: 80 } }.

   This is deliberately not a language model. Invoking a converter is
   intent classification plus slot filling — a solved, bounded problem —
   and solving it with rules rather than weights buys three things the
   site actually needs: it runs with nothing installed, it answers in
   microseconds, and it is testable in CI. A 4GB model behind a setup
   wall could not claim any of those.

   Every word it knows comes from spec/manifest.json. Teaching it a new
   tool means adding a manifest entry, not editing this file.

   The parser reports what was SAID, not what is legal: "quality 200"
   parses to 200 and is rejected later by validateArgs. Clamping here
   would silently ignore what the visitor asked for.

   Everything lives in one @pure block: no DOM, no network, no globals,
   so test/nlp.test.js can evaluate it under node and drive it with the
   shared fixtures in spec/nlp-fixtures.json. The Python port in
   thehallucinatedlab/nlp/ implements the same rules against the same
   fixtures — if the two drift, both suites go red.
   ============================================================ */
(function () {
  'use strict';

  /* @pure-start — no DOM, no network, no module state. */

  /* A preposition here means the format that follows it is the target:
     "png to webp" wants webp, not png. Without one, the last format
     mentioned wins ("make this a png"). */
  var DIRECTIONAL = ['to', 'into', 'as'];

  /* Deliberately small. A full CSS colour table would be mostly dead
     weight for a flatten-the-alpha-channel setting, and every name in
     it is a name the parser could misfire on. */
  var NAMED_COLORS = {
    black: '#000000',
    white: '#ffffff',
    gray: '#808080',
    grey: '#808080'
  };

  function normalize(text) {
    return String(text === null || text === undefined ? '' : text)
      .toLowerCase()
      .trim();
  }

  /* Hex first so "#f00" survives as one token rather than splitting into
     a stray "f" and "00". Numbers keep a trailing % so "50%" can be read
     as an explicit quality cue while a bare "50" cannot. */
  function tokenize(text) {
    var matches = normalize(text).match(/#[0-9a-f]{3,8}|[a-z]+|\d+%?/g);
    return matches || [];
  }

  function expandHex(token) {
    var short = /^#([0-9a-f]{3})$/.exec(token);
    if (short) {
      return '#' + short[1].charAt(0) + short[1].charAt(0) +
                   short[1].charAt(1) + short[1].charAt(1) +
                   short[1].charAt(2) + short[1].charAt(2);
    }
    var full = /^#([0-9a-f]{6})$/.exec(token);
    return full ? '#' + full[1] : null;
  }

  function numericToken(token) {
    var m = /^(\d+)%?$/.exec(token);
    return m ? parseInt(m[1], 10) : null;
  }

  /* Every spelling of an enum value mapped to its canonical form, so
     "jpg", "jpe" and "jfif" all resolve to "jpeg". */
  function enumVocabulary(param) {
    var vocab = {};
    var values = param.values || [];
    for (var i = 0; i < values.length; i++) vocab[values[i]] = values[i];
    var aliases = param.aliases || {};
    for (var key in aliases) {
      if (Object.prototype.hasOwnProperty.call(aliases, key)) vocab[key] = aliases[key];
    }
    return vocab;
  }

  function enumParams(tool) {
    return (tool.params || []).filter(function (p) { return p.type === 'enum'; });
  }

  /* ---- Stage 2: which tool is this about? ----
     Additive weights, capped at 1. The threshold is set so a lone action
     word cannot match: "convert 100 usd to eur" scores 0.4 and correctly
     falls through to chat, while "convert image" reaches 0.6 and asks
     which format. */
  function scoreTool(tool, norm, tokens, weights) {
    var present = {};
    for (var i = 0; i < tokens.length; i++) present[tokens[i]] = true;

    var score = 0;
    var params = enumParams(tool);
    for (var p = 0; p < params.length; p++) {
      var vocab = enumVocabulary(params[p]);
      for (var t = 0; t < tokens.length; t++) {
        if (Object.prototype.hasOwnProperty.call(vocab, tokens[t])) {
          score += weights.enumValue;
          p = params.length;
          break;
        }
      }
    }

    var aliases = tool.aliases || [];
    for (var a = 0; a < aliases.length; a++) {
      if (norm.indexOf(aliases[a]) !== -1) { score += weights.aliasPhrase; break; }
    }

    var kw = tool.keywords || {};
    var actions = kw.action || [];
    for (var k = 0; k < actions.length; k++) {
      if (present[actions[k]]) { score += weights.actionKeyword; break; }
    }
    var subjects = kw.subject || [];
    for (var s = 0; s < subjects.length; s++) {
      if (present[subjects[s]]) { score += weights.subjectKeyword; break; }
    }

    return Math.min(1, score);
  }

  /* ---- Stage 3: slot filling ---- */

  function resolveEnum(param, tokens) {
    var vocab = enumVocabulary(param);
    var hits = [];
    var lastDirectional = -1;

    for (var i = 0; i < tokens.length; i++) {
      if (Object.prototype.hasOwnProperty.call(vocab, tokens[i])) {
        hits.push({ index: i, value: vocab[tokens[i]] });
      }
      if (DIRECTIONAL.indexOf(tokens[i]) !== -1) lastDirectional = i;
    }
    if (!hits.length) return null;

    if (lastDirectional !== -1) {
      for (var h = 0; h < hits.length; h++) {
        if (hits[h].index > lastDirectional) return hits[h];
      }
    }
    return hits[hits.length - 1];
  }

  /* Explicit cues beat position. The bare-number rule is last and only
     looks after the format token, which is what stops "convert 2 images
     to png" from reading 2 as a quality. */
  function resolveInteger(param, tokens, formatIndex) {
    var kws = param.keywords || [];
    var i, n;

    for (i = 0; i < tokens.length - 1; i++) {
      if (kws.indexOf(tokens[i]) !== -1) {
        n = numericToken(tokens[i + 1]);
        if (n !== null) return n;
      }
    }
    for (i = 1; i < tokens.length; i++) {
      if (kws.indexOf(tokens[i]) !== -1) {
        n = numericToken(tokens[i - 1]);
        if (n !== null) return n;
      }
    }
    for (i = 0; i < tokens.length - 1; i++) {
      if (tokens[i] === 'at') {
        n = numericToken(tokens[i + 1]);
        if (n !== null) return n;
      }
    }
    for (i = 0; i < tokens.length; i++) {
      if (/^\d+%$/.test(tokens[i])) return numericToken(tokens[i]);
    }
    if (formatIndex >= 0) {
      for (i = formatIndex + 1; i < tokens.length; i++) {
        n = numericToken(tokens[i]);
        if (n !== null) return n;
      }
    }
    return null;
  }

  /* A hex code anywhere is unambiguous. A colour NAME only counts next
     to one of the parameter's own keywords, so "a black and white photo
     to png" does not quietly set a background. */
  function resolveColor(param, tokens) {
    var i;
    for (i = 0; i < tokens.length; i++) {
      var hex = expandHex(tokens[i]);
      if (hex) return hex;
    }
    var kws = param.keywords || [];
    for (i = 0; i < tokens.length; i++) {
      if (kws.indexOf(tokens[i]) === -1) continue;
      var neighbours = [i - 1, i + 1, i - 2];
      for (var j = 0; j < neighbours.length; j++) {
        var at = neighbours[j];
        if (at < 0 || at >= tokens.length) continue;
        if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, tokens[at])) {
          return NAMED_COLORS[tokens[at]];
        }
      }
    }
    return null;
  }

  function fillSlots(tool, tokens) {
    var args = {};
    var formatIndex = -1;
    var params = tool.params || [];
    var i, param;

    /* Enums first: their position anchors the bare-number rule below. */
    for (i = 0; i < params.length; i++) {
      param = params[i];
      if (param.type !== 'enum') continue;
      var hit = resolveEnum(param, tokens);
      if (hit) {
        args[param.name] = hit.value;
        if (formatIndex < 0) formatIndex = hit.index;
      }
    }

    for (i = 0; i < params.length; i++) {
      param = params[i];
      if (param.type === 'integer') {
        var n = resolveInteger(param, tokens, formatIndex);
        if (n !== null) args[param.name] = n;
      } else if (param.type === 'color') {
        var c = resolveColor(param, tokens);
        if (c !== null) args[param.name] = c;
      }
    }
    return args;
  }

  /* ---- The pipeline ---- */
  function parseIntent(text, manifest) {
    var blank = { tool: null, args: {}, missing: [], confidence: 0 };
    if (!manifest || !manifest.tools || !manifest.tools.length) return blank;

    var norm = normalize(text);
    var tokens = tokenize(norm);
    if (!tokens.length) return blank;

    var weights = manifest.scoring || {};
    var best = null;
    var bestScore = 0;

    for (var i = 0; i < manifest.tools.length; i++) {
      var score = scoreTool(manifest.tools[i], norm, tokens, weights);
      if (score > bestScore) { bestScore = score; best = manifest.tools[i]; }
    }

    if (!best || bestScore < weights.threshold) return blank;

    var args = fillSlots(best, tokens);
    var missing = [];
    var params = best.params || [];
    for (var p = 0; p < params.length; p++) {
      if (params[p].required && !Object.prototype.hasOwnProperty.call(args, params[p].name)) {
        missing.push(params[p].name);
      }
    }

    return {
      tool: best.name,
      args: args,
      missing: missing,
      confidence: Math.round(bestScore * 100) / 100
    };
  }

  /* Merges a follow-up utterance into a parse that stalled on a missing
     slot, so "convert this" -> "which format?" -> "png" completes the
     original request instead of starting a new one. */
  function mergeAnswer(pending, text, manifest) {
    if (!pending || !pending.tool) return parseIntent(text, manifest);

    var tool = null;
    for (var i = 0; i < manifest.tools.length; i++) {
      if (manifest.tools[i].name === pending.tool) tool = manifest.tools[i];
    }
    if (!tool) return parseIntent(text, manifest);

    var found = fillSlots(tool, tokenize(text));
    var args = {};
    var key;
    for (key in pending.args) {
      if (Object.prototype.hasOwnProperty.call(pending.args, key)) args[key] = pending.args[key];
    }
    for (key in found) {
      if (Object.prototype.hasOwnProperty.call(found, key)) args[key] = found[key];
    }

    var missing = [];
    var params = tool.params || [];
    for (var p = 0; p < params.length; p++) {
      if (params[p].required && !Object.prototype.hasOwnProperty.call(args, params[p].name)) {
        missing.push(params[p].name);
      }
    }
    return { tool: tool.name, args: args, missing: missing, confidence: pending.confidence };
  }

  /* @pure-end */

  /* One global for the whole toolkit, matching the plain-script style of
     the rest of the site — there is no module system here to import
     through. */
  window.THL = window.THL || {};
  window.THL.nlp = {
    parse: parseIntent,
    mergeAnswer: mergeAnswer,
    tokenize: tokenize,
    normalize: normalize
  };

})();
