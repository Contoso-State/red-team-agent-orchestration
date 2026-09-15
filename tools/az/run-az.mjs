#!/usr/bin/env node
/**
 * Canonical, dependency-free Azure CLI runner.
 *
 * Two problems this exists to solve:
 *
 * 1. On Windows `az` is `az.cmd`, a batch wrapper. Node cannot spawn it directly:
 *    `spawnSync('az', ...)` fails ENOENT and `spawnSync('az.cmd', ...)` fails EINVAL
 *    since Node 20.12 refuses to run .cmd/.bat without a shell. Ad-hoc agent scripts
 *    hit this and silently recorded "0 findings" for checks that never ran. We resolve
 *    the CLI's bundled interpreter and invoke `python -m azure.cli` instead, so the
 *    child is a real executable and `shell: true` is never needed — no quoting or
 *    injection surface.
 *
 * 2. Every Azure call must still be provably read-only. Each invocation is classified
 *    by the shared guard before it runs, and a non-allow decision refuses to execute.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decideSafe } from '../../guardrails/guard.mjs';

/** Locate az.cmd / az on PATH without trusting the shell to do it. */
function findOnPath(names) {
  for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Resolve an argv that Node can spawn with shell:false on this platform.
 * Returns null when the Azure CLI cannot be located at all.
 */
export function resolveAzCommand(platform = process.platform) {
  if (platform !== 'win32') {
    const found = findOnPath(['az']);
    return found ? { file: found, prefix: [] } : null;
  }
  const wrapper = findOnPath(['az.cmd', 'az.bat']);
  if (wrapper) {
    // wbin\az.cmd -> CLI2\python.exe : the interpreter the wrapper itself calls.
    const cliRoot = dirname(dirname(wrapper));
    for (const python of [join(cliRoot, 'python.exe'), join(cliRoot, 'Scripts', 'python.exe')]) {
      if (existsSync(python)) return { file: python, prefix: ['-m', 'azure.cli'] };
    }
  }
  const exe = findOnPath(['az.exe']);
  return exe ? { file: exe, prefix: [] } : null;
}

/**
 * Run one read-only `az` invocation. `args` is an argv array, never a command string,
 * so nothing is re-parsed by a shell.
 */
export function runAz(args, { cwd = process.cwd(), timeoutMs = 120_000, maxBuffer = 64 * 1024 * 1024 } = {}) {
  if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) {
    throw new TypeError('runAz expects an array of string arguments');
  }
  const verdict = decideSafe({ command: ['az', ...args].join(' '), cwd, toolName: 'shell' });
  if (verdict.decision !== 'allow') {
    return { ok: false, status: null, stdout: '', stderr: '', json: null, refused: verdict.reason || 'refused by guardrails' };
  }
  const resolved = resolveAzCommand();
  if (!resolved) {
    return { ok: false, status: null, stdout: '', stderr: '', json: null, refused: 'Azure CLI not found on PATH' };
  }

  const result = spawnSync(resolved.file, [...resolved.prefix, ...args], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (result.error) {
    const reason = result.error.code === 'ETIMEDOUT' ? `timed out after ${timeoutMs}ms` : result.error.message;
    return { ok: false, status: null, stdout, stderr, json: null, refused: null, error: reason };
  }
  let json = null;
  if (stdout.trim()) { try { json = JSON.parse(stdout); } catch { json = null; } }
  return { ok: result.status === 0, status: result.status, stdout, stderr, json, refused: null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Usage: node tools/az/run-az.mjs <az arguments…>\nRuns one read-only az command without a shell. Refuses anything the guardrails do not classify as read-only.');
    process.exit(2);
  }
  const res = runAz(args);
  if (res.refused) { console.error(`Refused: ${res.refused}`); process.exit(3); }
  if (res.error) { console.error(`Failed: ${res.error}`); process.exit(1); }
  if (res.stdout) process.stdout.write(res.stdout);
  if (!res.ok && res.stderr) process.stderr.write(res.stderr);
  process.exit(res.ok ? 0 : 1);
}
