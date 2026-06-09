#!/usr/bin/env node
/**
 * flatten-kql.mjs — collapse a KQL query to a single line for `az graph query -q`.
 *
 * Azure Resource Graph queries passed as multi-line strings can be silently
 * mis-executed (the where/project/summarize pipeline is dropped, returning
 * unfiltered rows with no error). This helper flattens a .kql file (or stdin)
 * to one safe line: comments stripped, newlines → spaces, runs of whitespace
 * collapsed. Pipe-friendly.
 *
 * Usage:
 *   node tools/resource-graph/flatten-kql.mjs query.kql
 *   echo "Resources | count" | node tools/resource-graph/flatten-kql.mjs
 *   # then:  az graph query -q "$(node tools/resource-graph/flatten-kql.mjs query.kql)" -o json
 *
 * Read-only. Dependency-free.
 */

import { readFileSync } from 'node:fs';

function flatten(text) {
  // Normalize CRLF/CR -> LF first: otherwise a trailing "\r" keeps a `//` comment
  // alive after flattening (e.g. "Resources // x\r| count" -> the rest is commented out).
  const src = text.replace(/\r\n?/g, '\n');
  let out = '';
  let quote = null; // current string delimiter (' or "), or null when outside a string
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === '\\' && i + 1 < src.length) { out += src[++i]; continue; } // keep escaped char
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; continue; }
    // Strip `// ... ` line comments only when OUTSIDE a string literal.
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += ' ';
      continue;
    }
    out += c;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function read(path) {
  if (path) return readFileSync(path, 'utf8');
  return readFileSync(0, 'utf8'); // stdin
}

const out = flatten(read(process.argv[2]));
if (!out) {
  console.error('Error: empty query.');
  process.exit(1);
}
process.stdout.write(out + '\n');
