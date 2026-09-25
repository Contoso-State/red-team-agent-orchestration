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
import { spawnSync, spawn as spawnChild } from 'node:child_process';
import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decideSafe } from '../../guardrails/guard.mjs';

/** Locate az.cmd / az on PATH without trusting the shell to do it. */
function findOnPath(names, { env, exists, paths }) {
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path');
  for (const dir of (env[pathKey] || '').split(paths.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = paths.join(dir, name);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Resolve an argv that Node can spawn with shell:false on this platform.
 * Returns null when the Azure CLI cannot be located at all.
 */
export function resolveAzCommand(platform = process.platform, { env = process.env, exists = existsSync } = {}) {
  const paths = platform === 'win32' ? win32 : posix;
  const lookup = { env, exists, paths };
  if (platform !== 'win32') {
    const found = findOnPath(['az'], lookup);
    return found ? { file: found, prefix: [] } : null;
  }
  const wrapper = findOnPath(['az.cmd', 'az.bat'], lookup);
  if (wrapper) {
    // wbin\az.cmd -> CLI2\python.exe : the interpreter the wrapper itself calls.
    const cliRoot = paths.dirname(paths.dirname(wrapper));
    for (const python of [paths.join(cliRoot, 'python.exe'), paths.join(cliRoot, 'Scripts', 'python.exe')]) {
      if (exists(python)) return { file: python, prefix: ['-m', 'azure.cli'] };
    }
  }
  const exe = findOnPath(['az.exe'], lookup);
  return exe ? { file: exe, prefix: [] } : null;
}

/**
 * Run one read-only `az` invocation. `args` is an argv array, never a command string,
 * so nothing is re-parsed by a shell.
 */
function prepareAz(args, { cwd, env, resolveCommand }) {
  if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) {
    throw new TypeError('runAz expects an array of string arguments');
  }
  // Serialize only for guard classification. The subprocess receives the original
  // argv, including query pipes and punctuation, without any shell interpretation.
  const quote = value => /^[a-zA-Z0-9_./:@=-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
  const verdict = decideSafe({ command: ['az', ...args].map(quote).join(' '), cwd, toolName: 'shell' });
  if (verdict.decision !== 'allow') {
    return { ok: false, status: null, stdout: '', stderr: '', json: null, refused: verdict.reason || 'refused by guardrails' };
  }
  const resolved = resolveCommand(process.platform, { env });
  if (!resolved) {
    return { ok: false, status: null, stdout: '', stderr: '', json: null, refused: 'Azure CLI not found on PATH' };
  }

  return { resolved };
}

function resultOf(result, timeoutMs) {
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

export function runAz(args, { cwd = process.cwd(), env = process.env, timeoutMs = 120_000, maxBuffer = 64 * 1024 * 1024, spawn = spawnSync, resolveCommand = resolveAzCommand } = {}) {
  const prepared = prepareAz(args, { cwd, env, resolveCommand });
  if (!prepared.resolved) return prepared;
  const { resolved } = prepared;
  return resultOf(spawn(resolved.file, [...resolved.prefix, ...args], { cwd, env, shell: false, encoding: 'utf8', timeout: timeoutMs, maxBuffer }), timeoutMs);
}

/** Live readers use a direct async child so cancellation and streaming bounds apply
 * to Azure itself, without an intermediate Node CLI process that could orphan it. */
export async function runAzAsync(args, { cwd = process.cwd(), env = process.env, timeoutMs = 120_000, maxBuffer = 64 * 1024 * 1024, signal, spawn = spawnChild, resolveCommand = resolveAzCommand } = {}) {
  const prepared = prepareAz(args, { cwd, env, resolveCommand });
  if (!prepared.resolved) return prepared;
  if (signal?.aborted) return resultOf({ error: { message: 'Azure read cancelled' } }, timeoutMs);
  const { resolved } = prepared;
  return new Promise(resolve => {
    let child;
    try { child = spawn(resolved.file, [...resolved.prefix, ...args], { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { resolve(resultOf({ error }, timeoutMs)); return; }
    let stdout = [], stderr = [], bytes = 0, error;
    const stop = reason => { error ??= reason; child.kill('SIGKILL'); };
    const abort = () => stop({ message: 'Azure read cancelled' });
    const timer = setTimeout(() => stop({ code: 'ETIMEDOUT' }), timeoutMs);
    const capture = target => chunk => {
      if (error) return;
      bytes += chunk.length;
      if (bytes > maxBuffer) { stdout = []; stderr = []; stop({ message: 'Azure read output limit exceeded' }); }
      else target.push(chunk);
    };
    child.stdout.on('data', capture(stdout));
    child.stderr.on('data', capture(stderr));
    child.on('error', failure => { error ??= failure; });
    child.on('close', status => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      resolve(resultOf({ status, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), error }, timeoutMs));
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
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
