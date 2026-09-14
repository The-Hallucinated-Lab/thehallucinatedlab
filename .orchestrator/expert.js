#!/usr/bin/env node
'use strict';
/* Run one local expert through Ollama's HTTP API.
 *
 *   node .orchestrator/expert.js <expert> <prompt-file> [max-lines]
 *
 * `ollama run` is not used on purpose: on Windows it writes cursor-control
 * sequences to stdout even when piped, and they ended up inside a generated
 * test file. The API returns clean text, and it lets the per-expert
 * temperature in experts.tsv actually apply instead of living in a comment. */

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const TIMEOUT_MS = 20 * 60 * 1000; // a 14B draft on an 8 GB card can take a while

function registry() {
  const rows = fs.readFileSync(path.join(HERE, 'experts.tsv'), 'utf8').split('\n');
  const out = {};
  for (const row of rows) {
    if (!row.trim()) continue;
    const [name, model, temperature, role] = row.split('\t');
    out[name] = { model, temperature: Number(temperature), role };
  }
  return out;
}

async function main() {
  const [expert, promptFile, maxArg] = process.argv.slice(2);
  if (!expert || !promptFile) {
    console.error('usage: expert.js <expert> <prompt-file> [max-lines]');
    process.exit(2);
  }
  const spec = registry()[expert];
  if (!spec) {
    console.error(`UNKNOWN_EXPERT: ${expert}`);
    process.exit(2);
  }
  const system = fs.readFileSync(path.join(HERE, 'experts', spec.role), 'utf8');
  const prompt = fs.readFileSync(promptFile, 'utf8');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let body;
  try {
    const res = await fetch(`${HOST}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: spec.model,
        system,
        prompt,
        stream: false,
        keep_alive: '30m',
        options: { temperature: spec.temperature },
      }),
    });
    if (!res.ok) {
      console.error(`OLLAMA_HTTP_${res.status}: ${(await res.text()).slice(0, 200)}`);
      process.exit(3);
    }
    body = await res.json();
  } catch (err) {
    console.error(`OLLAMA_UNREACHABLE: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
    process.exit(3);
  } finally {
    clearTimeout(timer);
  }

  let text = String(body.response || '');
  const max = Number(maxArg || 0);
  if (max > 0) text = text.split('\n').slice(0, max).join('\n');
  process.stdout.write(text.endsWith('\n') ? text : text + '\n');
}

main();
