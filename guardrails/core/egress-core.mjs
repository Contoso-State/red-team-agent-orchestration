#!/usr/bin/env node
/**
 * egress-core.mjs — scope-lock for the External Vulnerability Agent (EVA).
 *
 * This is the safety spine that makes active external testing safe. EVA is the only agent
 * that sends real traffic to live endpoints, and the ironclad rule is: it may ONLY ever
 * touch a host that maps back to an in-scope Azure resource discovered during the
 * engagement. This module is the fail-closed enforcement of that rule at the tool layer.
 *
 * The redteam-guardrails preToolUse hook calls evaluateEgress() on every command. The flow:
 *
 *   1. Recognize an active-probe tool invocation (curl/wget/nuclei/zap/sqlmap/nikto/httpx/
 *      testssl/whatweb/nmap/Invoke-WebRequest/...). Non-probe commands are ignored here
 *      (the read-only az/azd matcher in guardrails-core.mjs handles those).
 *   2. Extract the targets the command would hit. Only PUBLIC internet hosts count as
 *      egress; localhost/RFC1918/private targets classify to null and are allowed (the
 *      read-only az guardrail still governs az/azd separately).
 *   3. If there is any public egress, require ALL of:
 *        - engagement mode === 'external-active-testing'
 *        - external_testing.enabled === true
 *        - authorization complete (attested_by + attestation_id non-empty, window valid)
 *        - an Azure-derived allowlist exists for the active session
 *        - every extracted target is on that allowlist
 *        - any scanner target-list file is exactly the allowlist file
 *      Otherwise: DENY (fail closed).
 *
 * Everything is pure and unit-tested in egress-core.test.mjs. Host classification is shared
 * with build-targets.mjs via host-classify.mjs (no node:sqlite import here).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { classifyCandidate } from '../../tools/external/host-classify.mjs';
import {
  normalizeExe,
  splitSegments,
  gatherCommandTexts,
  extractCommand,
  engagementMode,
} from './guardrails-core.mjs';

// ---------------------------------------------------------------------------
// Active-probe tool recognition
// ---------------------------------------------------------------------------

// Normalized (lowercased, path/extension-stripped) executable names that send real
// network traffic to a target. If a command's program is one of these AND it would reach
// a public host, it is gated by the external-testing scope lock.
const PROBE_TOOLS = new Set([
  // generic HTTP clients
  'curl', 'wget', 'http', 'httpie',
  'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm',
  'test-netconnection', 'tnc',
  // recon / fingerprinting
  'httpx', 'httprobe', 'whatweb', 'wafw00f', 'wappalyzer',
  // vuln scanners
  'nuclei', 'nikto', 'wpscan', 'nuclei.exe',
  // TLS
  'testssl', 'testssl.sh', 'sslscan', 'sslyze', 'openssl',
  // DAST / proxies
  'zap', 'zap.sh', 'zap-cli', 'zap-baseline', 'zap-baseline.py',
  'zap-full-scan', 'zap-full-scan.py', 'owasp-zap',
  // injection
  'sqlmap', 'sqlmap.py', 'commix',
  // content discovery
  'gobuster', 'ffuf', 'feroxbuster', 'dirb', 'dirsearch', 'dirsearch.py',
  // network scanners
  'nmap', 'masscan', 'ncat', 'nc', 'netcat',
]);

// Execution wrappers to skip past so `timeout 30 curl ...`, `env X=1 nuclei ...`, etc. are
// still recognized. Mirrors the spirit of guardrails-core's wrapper handling.
const WRAPPERS = new Set([
  'env', 'time', 'nice', 'ionice', 'nohup', 'setsid', 'stdbuf', 'unbuffer',
  'timeout', 'watch', 'sudo', 'doas', 'xargs', 'proxychains', 'proxychains4',
]);

// Flags whose VALUE is a target (URL/host).
const TARGET_VALUE_FLAGS = new Set([
  'u', 'url', 'target', 'targets', 'host', 'hosts', 'uri', 'connect', 'server',
]);

// Flags whose VALUE is a FILE that lists targets (a scope file).
const LIST_FILE_FLAGS = new Set([
  'l', 'list', 'il', 'target-file', 'targetfile', 'urls', 'hostfile', 'host-file',
]);

// Flags whose VALUE must be CONSUMED but is never itself a target (so a host-shaped value
// belonging to one of these is not mistaken for a positional target). Best-effort union
// across the supported scanners.
const NONTARGET_VALUE_FLAGS = new Set([
  'o', 'output', 'on', 'ox', 'og', 'oa', 'oj', 'oz',
  'w', 'wordlist', 'h', 'header', 'headers',
  't', 'threads', 'c', 'concurrency', 'rl', 'rate', 'rate-limit', 'rate-per-second',
  'd', 'data', 'data-raw', 'data-binary', 'b', 'cookie', 'cookies',
  'a', 'user-agent', 'ua', 'e', 'referer', 'x', 'proxy', 'proxychain',
  'r', 'config', 'conf', 'p', 'port', 'ports', 'timeout', 'retries', 'retry',
  'm', 'method', 'tags', 'templates', 'template', 'severity', 's',
  'level', 'risk', 'dbms', 'technique', 'delay', 'mc', 'fc', 'fs', 'ms',
  'max-time', 'connect-timeout', 'resolve', 'interface', 'iface',
]);

const FILE_EXT_RE =
  /\.(txt|json|ya?ml|csv|tsv|xml|conf|cfg|ini|log|lst|list|tmpl|nuclei|py|sh|ps1|bat|cmd|html?|js|mjs|md|pem|crt|key|cookies?)$/i;

function isFileLikeToken(t) {
  if (!t) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return false; // an explicit URL is never a "file"
  if (/^\.{1,2}[\\/]/.test(t)) return true;              // ./  ../
  if (/^[\\/]/.test(t)) return true;                     // /abs or \abs
  if (/^~[\\/]/.test(t)) return true;                    // ~/...
  if (/^[a-z]:[\\/]/i.test(t)) return true;              // C:\...
  if (FILE_EXT_RE.test(t.split(/[\\/]/).pop() || t)) return true;
  return false;
}

function norm(token) {
  return normalizeExe(token || '').toLowerCase();
}

/**
 * Identify the probe-tool invocation at the start of a single command segment, skipping
 * execution wrappers. Returns { tool, tokens } where tokens begins at the probe program,
 * or null if the segment is not a recognized probe invocation.
 */
export function probeInvocation(segment) {
  if (typeof segment !== 'string' || !segment.trim()) return null;
  let s = segment.trim();
  s = s.replace(/^[&\s]+/, '');                 // leading & and whitespace (pwsh call op)
  s = s.replace(/^(?:[A-Za-z_][\w]*=\S+\s+)+/, ''); // leading VAR=val env assignments
  let tokens = s.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  let guard = 0;
  while (tokens.length && WRAPPERS.has(norm(tokens[0])) && guard++ < 6) {
    const w = norm(tokens[0]);
    tokens = tokens.slice(1);
    // skip the wrapper's own option flags and (for timeout/watch) a leading duration
    while (tokens.length && tokens[0].startsWith('-')) tokens = tokens.slice(1);
    if (tokens.length && /^\d+(\.\d+)?[smhd]?$/i.test(tokens[0])) tokens = tokens.slice(1);
    // env/sudo can be followed by VAR=val assignments before the real command
    if (w === 'env' || w === 'sudo' || w === 'doas') {
      while (tokens.length && /^[A-Za-z_][\w]*=\S*$/.test(tokens[0])) tokens = tokens.slice(1);
    }
  }
  if (!tokens.length) return null;

  const exe = norm(tokens[0]);
  if (!PROBE_TOOLS.has(exe)) return null;
  // openssl is only a network probe when used as a client (s_client / s_time).
  if (exe === 'openssl' && !tokens.some((t) => /^s_(client|time)$/i.test(t))) return null;
  return { tool: exe, tokens };
}

/**
 * Parse a single command segment into the external egress it would perform.
 * Returns null if it is not a probe invocation, otherwise:
 *   { tool, targets: [publicHost...], files: [listFilePath...] }
 * Only PUBLIC hosts appear in `targets` (localhost/private classify to null and are
 * dropped — they are not external egress).
 */
export function parseProbeSegment(segment) {
  const inv = probeInvocation(segment);
  if (!inv) return null;
  const { tool, tokens } = inv;
  const targets = [];
  const files = [];
  const seen = new Set();

  const addTarget = (val) => {
    const cls = classifyCandidate(val);
    if (cls && !seen.has(cls.host)) {
      seen.add(cls.host);
      targets.push(cls.host);
    }
  };

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--') continue;
    if (t.startsWith('-')) {
      const eq = t.indexOf('=');
      const rawName = (eq >= 0 ? t.slice(0, eq) : t).replace(/^--?/, '').toLowerCase();
      const inlineVal = eq >= 0 ? t.slice(eq + 1) : null;
      if (TARGET_VALUE_FLAGS.has(rawName)) {
        const v = inlineVal != null ? inlineVal : tokens[++i];
        if (v != null) addTarget(v);
      } else if (LIST_FILE_FLAGS.has(rawName)) {
        const v = inlineVal != null ? inlineVal : tokens[++i];
        if (v != null && v !== '') files.push(v);
      } else if (NONTARGET_VALUE_FLAGS.has(rawName)) {
        if (inlineVal == null) i++; // consume the value token, ignore it
      }
      // unknown/boolean flag: consume nothing
      continue;
    }
    // bare positional token
    if (isFileLikeToken(t)) continue; // positional file (e.g. a wordlist) is not a target
    addTarget(t);
  }

  return { tool, targets, files };
}

// ---------------------------------------------------------------------------
// External-testing configuration (best-effort YAML read, no dependency)
// ---------------------------------------------------------------------------

function sliceTopBlock(text, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  if (start < 0) return null;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l) && l.trim() !== '') break; // next top-level key ends the block
    out.push(l);
  }
  return out.join('\n');
}

function scalar(block, key) {
  if (!block) return undefined;
  const m = block.match(new RegExp(`^\\s+${key}\\s*:\\s*['"]?([^'"#\\n]+?)['"]?\\s*(?:#.*)?$`, 'm'));
  return m ? m[1].trim() : undefined;
}

function boolScalar(block, key) {
  const v = scalar(block, key);
  if (v === undefined) return undefined;
  return /^(true|yes|on|1)$/i.test(v);
}

/**
 * Read the external_testing config from engagement.yaml (best-effort, no YAML dep).
 * Returns { mode, enabled, attested_by, attestation_id, window_start, window_end }.
 * A missing file / block yields disabled defaults (safe).
 */
export function readExternalTestingConfig(cwd) {
  const result = {
    mode: engagementMode(cwd),
    enabled: false,
    attested_by: undefined,
    attestation_id: undefined,
    window_start: undefined,
    window_end: undefined,
  };
  try {
    const path = join(cwd || '.', 'engagement.yaml');
    if (!existsSync(path)) return result;
    const text = readFileSync(path, 'utf8');
    const block = sliceTopBlock(text, 'external_testing');
    if (!block) return result;
    result.enabled = boolScalar(block, 'enabled') === true;
    result.attested_by = scalar(block, 'attested_by');
    result.attestation_id = scalar(block, 'attestation_id');
    result.window_start = scalar(block, 'authorized_window_start');
    result.window_end = scalar(block, 'authorized_window_end');
  } catch {
    // fall through to safe defaults
  }
  return result;
}

// ---------------------------------------------------------------------------
// Allowlist loading (active session -> scope/external-targets.json)
// ---------------------------------------------------------------------------

function currentSessionDir(cwd) {
  try {
    const marker = join(cwd || '.', 'engagements', '.current-session');
    if (!existsSync(marker)) return null;
    const name = readFileSync(marker, 'utf8').trim();
    if (!name) return null;
    // marker may hold a bare session name or a full/relative path
    if (/[\\/]/.test(name)) return resolve(cwd || '.', name);
    return resolve(cwd || '.', 'engagements', name);
  } catch {
    return null;
  }
}

/**
 * Load the active session's Azure-derived allowlist. Returns
 *   { hosts:Set<string>, ips:Set<string>, hash, path }
 * or null if no allowlist exists (which the gate treats as fail-closed).
 */
export function loadAllowlist(cwd) {
  const dir = currentSessionDir(cwd);
  if (!dir) return null;
  const path = join(dir, 'scope', 'external-targets.json');
  if (!existsSync(path)) return null;
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  const allow = doc && doc.allowlist ? doc.allowlist : {};
  const hosts = new Set((allow.hosts || []).map((h) => String(h).toLowerCase()));
  const ips = new Set((allow.ips || []).map((h) => String(h).toLowerCase()));
  return { hosts, ips, hash: doc.content_hash, path: resolve(path) };
}

/** True if a classified host is present on the allowlist (host set or ip set). */
export function onAllowlist(host, allowlist) {
  if (!allowlist || !host) return false;
  const h = String(host).toLowerCase();
  return allowlist.hosts.has(h) || allowlist.ips.has(h);
}

// ---------------------------------------------------------------------------
// The external-testing gate
// ---------------------------------------------------------------------------

/**
 * Evaluate whether active external probing is currently authorized at all (independent of
 * any specific target). Returns { ok:true, allowlist } or { ok:false, reason }.
 */
export function externalTestingGate(cwd, now = new Date()) {
  const cfg = readExternalTestingConfig(cwd);
  if (cfg.mode !== 'external-active-testing') {
    return {
      ok: false,
      reason:
        `active external probing requires engagement mode 'external-active-testing' ` +
        `(current mode: '${cfg.mode}')`,
    };
  }
  if (!cfg.enabled) {
    return { ok: false, reason: `external_testing.enabled must be true to run active external probes` };
  }
  if (!cfg.attested_by || !cfg.attestation_id) {
    return {
      ok: false,
      reason:
        `external_testing.authorization is incomplete — both attested_by and ` +
        `attestation_id must be set before any external probe`,
    };
  }
  if (cfg.window_start) {
    const ws = Date.parse(cfg.window_start);
    if (!Number.isNaN(ws) && now.getTime() < ws) {
      return { ok: false, reason: `authorized testing window has not started yet (${cfg.window_start})` };
    }
  }
  if (cfg.window_end) {
    const we = Date.parse(cfg.window_end);
    if (!Number.isNaN(we) && now.getTime() > we) {
      return { ok: false, reason: `authorized testing window has expired (${cfg.window_end})` };
    }
  }
  const allowlist = loadAllowlist(cwd);
  if (!allowlist) {
    return {
      ok: false,
      reason:
        `no Azure-derived target allowlist found for the active session ` +
        `(run tools/external/build-targets.mjs to generate scope/external-targets.json)`,
    };
  }
  if (allowlist.hosts.size === 0 && allowlist.ips.size === 0) {
    return { ok: false, reason: `the Azure-derived allowlist is empty — there are no in-scope external targets` };
  }
  return { ok: true, allowlist };
}

// ---------------------------------------------------------------------------
// Top-level decision used by the preToolUse hook.
//   { deny: true, reason, segment, tool } -> block
//   { deny: false }                       -> allow (no external egress, or fully in-scope)
// ---------------------------------------------------------------------------

/**
 * Verify that a scanner target-list file only references in-scope hosts. The engagement
 * allowlist JSON itself is always accepted (fast path). For any other file, every public
 * host listed must be on the allowlist; an unreadable file fails closed (we cannot prove
 * scope). Comment lines (`#`) and local/private entries are ignored.
 */
export function verifyTargetFile(absPath, allowlist) {
  if (absPath === allowlist.path) return { ok: true };
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return { ok: false, reason: `cannot read scanner target-list file '${absPath}' to verify it is in scope` };
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const cls = classifyCandidate(line);
    if (!cls) continue; // local/private/non-host line is not external egress
    if (!onAllowlist(cls.host, allowlist)) {
      return {
        ok: false,
        reason: `scanner target-list file '${absPath}' contains out-of-scope host '${cls.host}'`,
      };
    }
  }
  return { ok: true };
}

export function evaluateEgress(toolArgs, cwd, toolName = '', now = new Date()) {
  const command = extractCommand(toolArgs, toolName);
  if (!command) return { deny: false };

  for (const text of gatherCommandTexts(command)) {
    for (const segment of splitSegments(text)) {
      const probe = parseProbeSegment(segment);
      if (!probe) continue;
      // No public egress (purely localhost/private, or no resolvable target) => not our concern.
      if (probe.targets.length === 0 && probe.files.length === 0) continue;

      const gate = externalTestingGate(cwd, now);
      if (!gate.ok) {
        return {
          deny: true,
          tool: probe.tool,
          segment,
          reason: `${gate.reason}`,
        };
      }
      // Any scanner target-list file must only reference in-scope hosts.
      for (const f of probe.files) {
        const v = verifyTargetFile(resolve(cwd || '.', f), gate.allowlist);
        if (!v.ok) {
          return { deny: true, tool: probe.tool, segment, reason: v.reason };
        }
      }
      // Every explicit target must be on the Azure-derived allowlist.
      for (const h of probe.targets) {
        if (!onAllowlist(h, gate.allowlist)) {
          return {
            deny: true,
            tool: probe.tool,
            segment,
            reason:
              `target '${h}' is not on the Azure-derived allowlist — EVA may only probe ` +
              `hosts published by in-scope Azure resources`,
          };
        }
      }
    }
  }
  return { deny: false };
}
