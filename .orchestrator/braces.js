'use strict';
/* CSS brace balance, same algorithm as test/site-invariants.test.js: strip
   comments, count { and }. A negative depth or a non-zero end is a defect. */
const fs = require('fs');
const css = fs.readFileSync(process.argv[2], 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
let depth = 0;
for (const ch of css) {
  if (ch === '{') depth++;
  else if (ch === '}') depth--;
  if (depth < 0) break;
}
if (depth !== 0) {
  console.error(`CSS_BRACE_IMBALANCE depth=${depth}`);
  process.exit(1);
}
