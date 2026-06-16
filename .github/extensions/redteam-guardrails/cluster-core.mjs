#!/usr/bin/env node
/**
 * cluster-core.mjs — cluster-active scope-lock for the Azure Container & Kubernetes Agent.
 *
 * This is the third fail-closed evaluator in the redteam-guardrails preToolUse chain (after
 * the read-only az gate in guardrails-core.mjs and the EVA egress lock in egress-core.mjs).
 * It governs everything that reaches *into* a live Kubernetes cluster or container runtime.
 *
 * Two independent guarantees, both fail-closed:
 *
 *   1. READ-ONLY POSTURE IS ABSOLUTE FOR KUBERNETES.
 *      Mutating `kubectl` verbs (apply/create/delete/patch/edit/replace/scale/rollout
 *      restart/drain/cordon/...) and mutating `helm`/runtime subcommands are DENIED in
 *      EVERY engagement mode. The posture lane never changes a workload. Read-only kubectl
 *      (get/describe/logs/auth can-i/top/version/explain/api-resources/cluster-info/config)
 *      is always allowed.
 *
 *   2. CLUSTER-ACTIVE TOOLS ARE GATED EXACTLY LIKE EVA EGRESS.
 *      Tools that execute inside a cluster/container or pull+scan images
 *      (`kubectl exec/debug/cp/attach/port-forward/run/proxy`, `kube-bench`, `kubesec`,
 *      `trivy`, `grype`, `crictl`, and active `docker`/`nerdctl`/`podman` subcommands) are
 *      DENIED unless ALL of the following hold:
 *        - engagement mode === 'cluster-active-testing'
 *        - cluster_testing.enabled === true
 *        - authorization complete (attested_by + attestation_id non-empty, window valid)
 *        - a non-empty Azure-derived cluster allowlist exists for the active session
 *      For image scanners, any explicit *.azurecr.io image reference must additionally be on
 *      the allowlist's registries. Anything we cannot prove in-scope fails closed.
 *
 * Pure + unit-tested in cluster-core.test.mjs. Dependency-free (node:fs / node:path only).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  normalizeExe,
  splitSegments,
  gatherCommandTexts,
  extractCommand,
  engagementMode,
} from './guardrails-core.mjs';

// ---------------------------------------------------------------------------
// Tool recognition
// ---------------------------------------------------------------------------

// Standalone tools that are inherently cluster-/image-active. Any invocation is gated.
const ACTIVE_STANDALONE = new Set([
  'kube-bench', 'kubesec', 'trivy', 'grype', 'crictl',
]);

// Container runtimes — subcommand-aware (read-only subcommands allowed, the rest gated).
const CONTAINER_RUNTIMES = new Set(['docker', 'nerdctl', 'podman']);
const RUNTIME_READ_SUBCMDS = new Set([
  'ps', 'images', 'image', 'inspect', 'version', 'info', 'logs', 'history', 'top', 'port', 'diff',
]);
// docker/nerdctl/podman subcommands that reach into / run / mutate containers or pull layers.
const RUNTIME_ACTIVE_SUBCMDS = new Set([
  'run', 'exec', 'attach', 'cp', 'create', 'start', 'commit', 'build', 'push', 'pull',
  'rm', 'rmi', 'kill', 'stop', 'restart', 'rename', 'update', 'load', 'save', 'tag',
]);

// helm — subcommand-aware (read-only allowed, mutating denied in all modes).
const HELM_READ_SUBCMDS = new Set([
  'list', 'ls', 'get', 'status', 'show', 'history', 'search', 'version', 'env', 'repo', 'template', 'lint',
]);
const HELM_MUTATING_SUBCMDS = new Set([
  'install', 'upgrade', 'uninstall', 'delete', 'rollback', 'reset', 'create', 'push',
]);

// kubectl verbs ------------------------------------------------------------
const KUBECTL_READ_VERBS = new Set([
  'get', 'describe', 'logs', 'top', 'version', 'explain', 'api-resources', 'api-versions',
  'cluster-info', 'config', 'events', 'wait', 'diff', 'kustomize', 'completion', 'options', 'help',
]);
// Reach-into-cluster verbs — gated behind the full cluster-active gate.
const KUBECTL_GATED_VERBS = new Set([
  'exec', 'debug', 'cp', 'attach', 'port-forward', 'run', 'proxy',
]);
// Mutating verbs — DENIED in every mode.
const KUBECTL_MUTATING_VERBS = new Set([
  'apply', 'create', 'delete', 'patch', 'edit', 'replace', 'set', 'scale', 'autoscale',
  'expose', 'label', 'annotate', 'taint', 'drain', 'cordon', 'uncordon', 'evict',
  'certificate', 'approve', 'deny', 'rollback', 'apply-set',
]);

// kubectl global flags that consume a value (so a verb scan skips past `--context foo`).
const KUBECTL_VALUE_FLAGS = new Set([
  'context', 'cluster', 'user', 'n', 'namespace', 'kubeconfig', 'server', 's', 'token',
  'as', 'as-group', 'request-timeout', 'tls-server-name', 'certificate-authority',
  'client-certificate', 'client-key', 'cache-dir', 'v', 'log-flush-frequency',
]);

// Execution wrappers to skip so `timeout 30 kubectl ...`, `sudo trivy ...` are still seen.
const WRAPPERS = new Set([
  'env', 'time', 'nice', 'ionice', 'nohup', 'setsid', 'stdbuf', 'unbuffer',
  'timeout', 'watch', 'sudo', 'doas', 'xargs', 'proxychains', 'proxychains4',
]);

function norm(token) {
  return normalizeExe(token || '').toLowerCase();
}

/**
 * Identify the cluster-relevant invocation at the start of a segment, skipping execution
 * wrappers. Returns { tool, tokens } where tokens begins at the program, or null if the
 * segment does not invoke a tool this module governs.
 */
export function clusterInvocation(segment) {
  if (typeof segment !== 'string' || !segment.trim()) return null;
  let s = segment.trim();
  s = s.replace(/^[&\s]+/, '');
  s = s.replace(/^(?:[A-Za-z_][\w]*=\S+\s+)+/, ''); // leading VAR=val env assignments
  let tokens = s.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  let guard = 0;
  while (tokens.length && WRAPPERS.has(norm(tokens[0])) && guard++ < 6) {
    const w = norm(tokens[0]);
    tokens = tokens.slice(1);
    while (tokens.length && tokens[0].startsWith('-')) tokens = tokens.slice(1);
    if (tokens.length && /^\d+(\.\d+)?[smhd]?$/i.test(tokens[0])) tokens = tokens.slice(1);
    if (w === 'env' || w === 'sudo' || w === 'doas') {
      while (tokens.length && /^[A-Za-z_][\w]*=\S*$/.test(tokens[0])) tokens = tokens.slice(1);
    }
  }
  if (!tokens.length) return null;

  const exe = norm(tokens[0]);
  if (
    exe === 'kubectl' ||
    exe === 'helm' ||
    ACTIVE_STANDALONE.has(exe) ||
    CONTAINER_RUNTIMES.has(exe)
  ) {
    return { tool: exe, tokens };
  }
  return null;
}

/** First bare (non-flag, non-flag-value) token after the program — the subcommand/verb. */
function firstSubcommand(tokens, valueFlags = new Set()) {
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--') continue;
    if (t.startsWith('-')) {
      const eq = t.indexOf('=');
      const name = (eq >= 0 ? t.slice(0, eq) : t).replace(/^--?/, '').toLowerCase();
      if (eq < 0 && valueFlags.has(name)) i++; // consume the value token
      continue;
    }
    return t.toLowerCase();
  }
  return '';
}

/** Second bare token (e.g. the `can-i` after `auth`, the `status` after `rollout`). */
function secondSubcommand(tokens, valueFlags = new Set()) {
  let seen = 0;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--') continue;
    if (t.startsWith('-')) {
      const eq = t.indexOf('=');
      const name = (eq >= 0 ? t.slice(0, eq) : t).replace(/^--?/, '').toLowerCase();
      if (eq < 0 && valueFlags.has(name)) i++;
      continue;
    }
    seen++;
    if (seen === 2) return t.toLowerCase();
  }
  return '';
}

/**
 * Pull the cluster-selector flags (--context / --cluster / --server|-s) out of a kubectl
 * token list. Reach-into-cluster verbs are scope-locked to one of these, so the kubeconfig
 * current-context can never silently widen scope. Stops at `--` (the in-container command).
 */
export function extractKubectlSelectors(tokens) {
  const sel = { context: undefined, cluster: undefined, server: undefined };
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--') break; // everything past `--` is the in-container command, not kubectl flags
    if (!t || !t.startsWith('-')) continue;
    const eq = t.indexOf('=');
    const name = (eq >= 0 ? t.slice(0, eq) : t).replace(/^--?/, '').toLowerCase();
    const isSelector = name === 'context' || name === 'cluster' || name === 'server' || name === 's';
    let val;
    if (eq >= 0) val = t.slice(eq + 1);
    else if (KUBECTL_VALUE_FLAGS.has(name)) { val = tokens[i + 1]; i++; } // consume the value token
    if (!isSelector || val == null) continue;
    const v = String(val).replace(/^['"]|['"]$/g, '').toLowerCase();
    if (!v) continue;
    if (name === 'context') sel.context = v;
    else if (name === 'cluster') sel.cluster = v;
    else sel.server = v; // --server / -s
  }
  return sel;
}

/** True if a kubectl invocation names an in-scope (allowlisted) cluster selector. */
export function hasKubectlClusterSelector(selectors) {
  return Boolean(selectors && (selectors.context || selectors.cluster || selectors.server));
}

/** True if a kubectl selector resolves to a cluster on the Azure-derived allowlist. */
export function kubectlTargetsAllowlistedCluster(selectors, allowlist) {
  if (!allowlist || !allowlist.clusters || !selectors) return false;
  for (const name of [selectors.context, selectors.cluster]) {
    if (name && allowlist.clusters.has(name)) return true;
  }
  if (selectors.server) {
    let host = selectors.server;
    try { host = new URL(selectors.server).host.toLowerCase(); } catch { /* not a URL; use raw value */ }
    host = host.replace(/:\d+$/, '');
    if (host && allowlist.clusters.has(host)) return true;
  }
  return false;
}

/**
 * Classify a single cluster invocation without consulting the gate. Returns one of:
 *   { kind: 'allow' }                       -> read-only, always permitted
 *   { kind: 'deny', reason }                -> mutating / unrecognized, denied in all modes
 *   { kind: 'gated', tool, images:[...] }   -> requires the cluster-active gate
 *   null                                    -> not a governed invocation
 */
export function classifyClusterSegment(segment) {
  const inv = clusterInvocation(segment);
  if (!inv) return null;
  const { tool, tokens } = inv;

  if (tool === 'kubectl') {
    const verb = firstSubcommand(tokens, KUBECTL_VALUE_FLAGS);
    if (!verb) return { kind: 'allow' }; // bare `kubectl` / help
    if (verb === 'auth') {
      const sub = secondSubcommand(tokens, KUBECTL_VALUE_FLAGS);
      return sub === 'can-i'
        ? { kind: 'allow' }
        : { kind: 'deny', reason: `kubectl auth ${sub || '<subcommand>'} is not a read-only operation` };
    }
    if (verb === 'rollout') {
      const sub = secondSubcommand(tokens, KUBECTL_VALUE_FLAGS);
      return sub === 'status' || sub === 'history'
        ? { kind: 'allow' }
        : { kind: 'deny', reason: `kubectl rollout ${sub || '<subcommand>'} mutates a workload (denied in all modes)` };
    }
    if (KUBECTL_READ_VERBS.has(verb)) return { kind: 'allow' };
    if (KUBECTL_GATED_VERBS.has(verb)) {
      return { kind: 'gated', tool: `kubectl ${verb}`, images: [], kube: true, selectors: extractKubectlSelectors(tokens) };
    }
    if (KUBECTL_MUTATING_VERBS.has(verb)) {
      return { kind: 'deny', reason: `kubectl ${verb} mutates cluster state — the posture is read-only (denied in all modes)` };
    }
    // Unknown verb: cannot prove read-only -> fail closed.
    return { kind: 'deny', reason: `kubectl ${verb} is not a recognized read-only verb (fail-closed)` };
  }

  if (tool === 'helm') {
    const sub = firstSubcommand(tokens);
    if (HELM_READ_SUBCMDS.has(sub)) return { kind: 'allow' };
    if (HELM_MUTATING_SUBCMDS.has(sub)) {
      return { kind: 'deny', reason: `helm ${sub} mutates release state — the posture is read-only (denied in all modes)` };
    }
    return { kind: 'deny', reason: `helm ${sub || '<subcommand>'} is not a recognized read-only operation (fail-closed)` };
  }

  if (CONTAINER_RUNTIMES.has(tool)) {
    const sub = firstSubcommand(tokens);
    if (RUNTIME_READ_SUBCMDS.has(sub)) return { kind: 'allow' };
    if (RUNTIME_ACTIVE_SUBCMDS.has(sub) || sub === '') {
      return { kind: 'gated', tool: `${tool} ${sub}`.trim(), images: extractImageRefs(tokens) };
    }
    // Unknown subcommand: gate it (fail-closed toward requiring authorization).
    return { kind: 'gated', tool: `${tool} ${sub}`, images: extractImageRefs(tokens) };
  }

  // ACTIVE_STANDALONE: kube-bench / kubesec / trivy / grype / crictl
  const images = tool === 'trivy' || tool === 'grype' ? extractImageRefs(tokens) : [];
  return { kind: 'gated', tool, images };
}

/** Best-effort: pull *.azurecr.io image references out of a scanner/runtime token list. */
export function extractImageRefs(tokens) {
  const out = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t || t.startsWith('-')) continue;
    // host[:port]/path... where host contains a dot (a registry reference)
    const host = t.split('/')[0];
    if (/\.azurecr\.io$/i.test(host) || /\.azurecr\.io[:/]/i.test(t)) {
      out.push(host.toLowerCase());
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// cluster_testing configuration (best-effort YAML read, no dependency)
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
 * Read the cluster_testing config from engagement.yaml (best-effort, no YAML dep).
 * Returns { mode, enabled, attested_by, attestation_id, window_start, window_end }.
 * A missing file / block yields disabled defaults (safe).
 */
export function readClusterTestingConfig(cwd) {
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
    const block = sliceTopBlock(text, 'cluster_testing');
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
// Allowlist loading (active session -> scope/cluster-targets.json)
// ---------------------------------------------------------------------------

function currentSessionDir(cwd) {
  try {
    const marker = join(cwd || '.', 'engagements', '.current-session');
    if (!existsSync(marker)) return null;
    const name = readFileSync(marker, 'utf8').trim();
    if (!name) return null;
    if (/[\\/]/.test(name)) return resolve(cwd || '.', name);
    return resolve(cwd || '.', 'engagements', name);
  } catch {
    return null;
  }
}

/**
 * Load the active session's Azure-derived cluster allowlist. Returns
 *   { clusters:Set<string>, registries:Set<string>, hash, path }
 * or null if no allowlist exists (which the gate treats as fail-closed).
 */
export function loadClusterAllowlist(cwd) {
  const dir = currentSessionDir(cwd);
  if (!dir) return null;
  const path = join(dir, 'scope', 'cluster-targets.json');
  if (!existsSync(path)) return null;
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  const allow = doc && doc.allowlist ? doc.allowlist : {};
  const clusters = new Set((allow.clusters || []).map((h) => String(h).toLowerCase()));
  const registries = new Set((allow.registries || []).map((h) => String(h).toLowerCase()));
  return { clusters, registries, hash: doc.content_hash, path: resolve(path) };
}

/** True if an *.azurecr.io host (or its short name) is on the registries allowlist. */
export function registryOnAllowlist(host, allowlist) {
  if (!allowlist || !host) return false;
  const h = String(host).toLowerCase();
  if (allowlist.registries.has(h)) return true;
  const short = h.replace(/\.azurecr\.io$/i, '');
  return allowlist.registries.has(short);
}

// ---------------------------------------------------------------------------
// The cluster-active gate
// ---------------------------------------------------------------------------

/**
 * Evaluate whether cluster-active testing is currently authorized at all (independent of
 * any specific tool). Returns { ok:true, allowlist } or { ok:false, reason }.
 */
export function clusterTestingGate(cwd, now = new Date()) {
  const cfg = readClusterTestingConfig(cwd);
  if (cfg.mode !== 'cluster-active-testing') {
    return {
      ok: false,
      reason:
        `cluster-active testing requires engagement mode 'cluster-active-testing' ` +
        `(current mode: '${cfg.mode}')`,
    };
  }
  if (!cfg.enabled) {
    return { ok: false, reason: `cluster_testing.enabled must be true to run cluster-active tools` };
  }
  if (!cfg.attested_by || !cfg.attestation_id) {
    return {
      ok: false,
      reason:
        `cluster_testing.authorization is incomplete — both attested_by and ` +
        `attestation_id must be set before any cluster-active action`,
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
  const allowlist = loadClusterAllowlist(cwd);
  if (!allowlist) {
    return {
      ok: false,
      reason:
        `no Azure-derived cluster allowlist found for the active session ` +
        `(run tools/cluster/build-cluster-targets.mjs to generate scope/cluster-targets.json)`,
    };
  }
  if (allowlist.clusters.size === 0 && allowlist.registries.size === 0) {
    return { ok: false, reason: `the Azure-derived cluster allowlist is empty — there are no in-scope clusters or registries` };
  }
  return { ok: true, allowlist };
}

// ---------------------------------------------------------------------------
// Top-level decision used by the preToolUse hook.
//   { deny: true, reason, segment, tool } -> block
//   { deny: false }                       -> allow
// ---------------------------------------------------------------------------

export function evaluateCluster(toolArgs, cwd, toolName = '', now = new Date()) {
  const command = extractCommand(toolArgs, toolName);
  if (!command) return { deny: false };

  for (const text of gatherCommandTexts(command)) {
    for (const segment of splitSegments(text)) {
      const cls = classifyClusterSegment(segment);
      if (!cls || cls.kind === 'allow') continue;

      if (cls.kind === 'deny') {
        return { deny: true, tool: cls.tool || 'kubectl', segment, reason: cls.reason };
      }

      // cls.kind === 'gated'
      const gate = clusterTestingGate(cwd, now);
      if (!gate.ok) {
        return { deny: true, tool: cls.tool, segment, reason: gate.reason };
      }
      // Any explicit *.azurecr.io image must be on the registries allowlist.
      for (const host of cls.images || []) {
        if (!registryOnAllowlist(host, gate.allowlist)) {
          return {
            deny: true,
            tool: cls.tool,
            segment,
            reason:
              `image registry '${host}' is not on the Azure-derived cluster allowlist — ` +
              `cluster-active scanning may only target in-scope ACR registries`,
          };
        }
      }
      // Reach-into-cluster kubectl verbs must explicitly name an in-scope cluster. The
      // kubeconfig current-context is NOT trusted for scope-lock (it could point at any
      // cluster the operator has credentials for), so we require --context/--cluster/--server.
      if (cls.kube) {
        if (!hasKubectlClusterSelector(cls.selectors)) {
          return {
            deny: true,
            tool: cls.tool,
            segment,
            reason:
              `${cls.tool} does not name a target cluster — reach-into-cluster verbs must pass an ` +
              `explicit --context (or --cluster/--server) matching an in-scope AKS cluster; the ` +
              `kubeconfig current-context is not trusted for scope-lock`,
          };
        }
        if (!kubectlTargetsAllowlistedCluster(cls.selectors, gate.allowlist)) {
          const named = cls.selectors.context || cls.selectors.cluster || cls.selectors.server;
          return {
            deny: true,
            tool: cls.tool,
            segment,
            reason:
              `${cls.tool} targets cluster '${named}', which is not on the Azure-derived cluster ` +
              `allowlist — cluster-active reach-in may only target in-scope AKS clusters`,
          };
        }
      }
    }
  }
  return { deny: false };
}
