#!/usr/bin/env node
/* ============================================================
   sync-spec.js — copies the tool spec into the Python package.

   spec/manifest.json is the source of truth for the website, the intent
   parser and the Python package alike. A wheel cannot reach outside its
   own root, so the package needs its own copy at
   python/thehallucinatedlab/data/manifest.json.

   Rather than a build hook that runs invisibly, the copy is committed
   and test/manifest.test.js asserts the two files are byte-identical.
   Editing the spec without running this turns the build red, which is
   the point: there is no state where the site documents one thing and
   the package accepts another.

     node scripts/sync-spec.js            copy
     node scripts/sync-spec.js --check    verify only, exit 1 on drift
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'spec', 'manifest.json');
const TARGET = path.join(ROOT, 'python', 'thehallucinatedlab', 'data', 'manifest.json');

const checkOnly = process.argv.includes('--check');
const source = fs.readFileSync(SOURCE);

if (checkOnly) {
  const target = fs.existsSync(TARGET) ? fs.readFileSync(TARGET) : null;
  if (target === null || !source.equals(target)) {
    console.error('spec/manifest.json and the packaged copy differ.');
    console.error('Run: node scripts/sync-spec.js');
    process.exit(1);
  }
  console.log('spec is in sync');
} else {
  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, source);
  console.log('copied spec/manifest.json -> python/thehallucinatedlab/data/manifest.json');
}
