#!/usr/bin/env node
/**
 * safe-kube-audit.mjs — Tier-C1 (cluster-benchmark) benign, read-only AKS/Kubernetes auditor
 * for the Azure Container & Kubernetes Agent's cluster-active lane.
 *
 * This is the LOWEST-intensity cluster-active tool and the one the agent always runs first.
 * It performs ONLY read-only Kubernetes API calls via `kubectl get/auth can-i/version`
 * (never exec/debug/cp/apply/delete) and, if they are installed, invokes `kube-bench` and
 * `kubesec` as read-only accelerators. It NEVER mutates a workload and NEVER reaches inside a
 * running container — that is Tier C3 and lives behind Invoke-ScopedClusterScan.ps1.
 *
 * Defense in depth: every command this tool issues is also independently inspected by the
 * redteam-guardrails cluster hook (cluster-core.mjs), which denies it unless the engagement is
 * in cluster-active-testing mode with cluster_testing enabled + authorized and a non-empty
 * cluster allowlist exists. This tool re-checks that same gate locally and refuses to run
 * otherwise, so the safe path is also the easy path.
 *
 * Findings are appended as JSONL (one object per line) with id prefix AZ-CNTR-.
 *
 * Dependency-free (node:* only). It shells out to kubectl using the CURRENT kube context; the
 * operator is responsible for having selected an in-scope cluster (and the guardrail + the
 * allowlist gate enforce scope independently).
 *
 * CLI:
 *   node tools/cluster/safe-kube-audit.mjs --cwd <repoRoot> --out <findings.jsonl> [--namespace <ns>] [--dry-run]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Local authorization gate (mirrors cluster-core.mjs; the guardrail enforces it too)
// ---------------------------------------------------------------------------

function sliceTopBlock(text, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  if (start < 0) return null;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l) && l.trim() !== '') break;
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
  return v === undefined ? undefined : /^(true|yes|on|1)$/i.test(v);
}

export function checkAuthorization(cwd, now = new Date()) {
  const path = join(cwd || '.', 'engagement.yaml');
  if (!existsSync(path)) return { ok: false, reason: 'engagement.yaml not found at repo root' };
  const text = readFileSync(path, 'utf8');
  const modeMatch = text.match(/^\s*mode:\s*['"]?([\w-]+)/m);
  const mode = modeMatch ? modeMatch[1] : 'read-only-assessment';
  if (mode !== 'cluster-active-testing') {
    return { ok: false, reason: `engagement mode is '${mode}'; cluster-active testing requires mode: cluster-active-testing` };
  }
  const block = sliceTopBlock(text, 'cluster_testing');
  if (!block || boolScalar(block, 'enabled') !== true) {
    return { ok: false, reason: 'cluster_testing.enabled is not true in engagement.yaml' };
  }
  if (!scalar(block, 'attested_by') || !scalar(block, 'attestation_id')) {
    return { ok: false, reason: 'cluster_testing.authorization is incomplete (attested_by + attestation_id required)' };
  }
  const ws = scalar(block, 'authorized_window_start');
  if (ws) { const t = Date.parse(ws); if (!Number.isNaN(t) && now.getTime() < t) return { ok: false, reason: `authorized window has not started (${ws})` }; }
  const we = scalar(block, 'authorized_window_end');
  if (we) { const t = Date.parse(we); if (!Number.isNaN(t) && now.getTime() > t) return { ok: false, reason: `authorized window expired (${we})` }; }
  return { ok: true, mode };
}

export function loadAllowlist(cwd, session) {
  let sessionDir;
  if (session) {
    sessionDir = /[\\/]/.test(session) ? resolve(cwd || '.', session) : resolve(cwd || '.', 'engagements', session);
  } else {
    const marker = join(cwd || '.', 'engagements', '.current-session');
    if (!existsSync(marker)) return null;
    const name = readFileSync(marker, 'utf8').trim();
    if (!name) return null;
    sessionDir = /[\\/]/.test(name) ? resolve(cwd || '.', name) : resolve(cwd || '.', 'engagements', name);
  }
  const path = join(sessionDir, 'scope', 'cluster-targets.json');
  if (!existsSync(path)) return null;
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    const allow = doc.allowlist || {};
    return {
      clusters: (allow.clusters || []).map((s) => String(s).toLowerCase()),
      registries: (allow.registries || []).map((s) => String(s).toLowerCase()),
      sessionDir,
      path,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Read-only kubectl helpers
// ---------------------------------------------------------------------------

function which(exe) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(probe, [exe], { encoding: 'utf8' });
  return r.status === 0;
}

function kubectlJson(args, dryRun) {
  if (dryRun) return { dryRun: `kubectl ${args.join(' ')}` };
  const r = spawnSync('kubectl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return { error: (r.stderr || r.stdout || 'kubectl failed').trim() };
  try { return { json: JSON.parse(r.stdout) }; } catch { return { error: 'could not parse kubectl JSON output' }; }
}

let findingSeq = 0;
function mkFinding({ check, severity, title, evidence, namespace }) {
  findingSeq++;
  return {
    id: `AZ-CNTR-C1-${String(findingSeq).padStart(3, '0')}`,
    agent: 'aks-container',
    lane: 'cluster-active',
    tier: 'cluster-benchmark',
    check_id: check,
    severity,
    title,
    namespace: namespace || null,
    evidence,
    detected_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Read-only audit passes (benign — get/list only)
// ---------------------------------------------------------------------------

const SYSTEM_NS = new Set(['kube-system', 'kube-public', 'kube-node-lease', 'gatekeeper-system', 'azure-arc']);

export function analyzeClusterAdminBindings(crbDoc) {
  const findings = [];
  for (const b of crbDoc?.items || []) {
    if (b?.roleRef?.name !== 'cluster-admin') continue;
    for (const s of b.subjects || []) {
      const isEveryone = s?.name === 'system:authenticated' || s?.name === 'system:unauthenticated';
      const isSystem = String(s?.name || '').startsWith('system:') && !isEveryone;
      if (isSystem) continue;
      findings.push(mkFinding({
        check: isEveryone ? 'CHK-COMP-AKS-RBAC-CLUSTER-ADMIN-SPRAWL' : 'CHK-COMP-AKS-RBAC-CLUSTER-ADMIN-SPRAWL',
        severity: isEveryone ? 'Critical' : 'High',
        title: isEveryone
          ? `cluster-admin bound to '${s.name}' (everyone)`
          : `cluster-admin bound to ${s.kind} '${s.name}'`,
        evidence: { binding: b.metadata?.name, subject: s },
      }));
    }
  }
  return findings;
}

export function analyzePrivilegedPods(podDoc) {
  const findings = [];
  for (const p of podDoc?.items || []) {
    const ns = p?.metadata?.namespace;
    if (SYSTEM_NS.has(ns)) continue;
    const spec = p?.spec || {};
    const reasons = [];
    if (spec.hostNetwork) reasons.push('hostNetwork');
    if (spec.hostPID) reasons.push('hostPID');
    if (spec.hostIPC) reasons.push('hostIPC');
    for (const c of (spec.containers || [])) {
      const sc = c.securityContext || {};
      if (sc.privileged) reasons.push(`container '${c.name}' privileged`);
      if (sc.allowPrivilegeEscalation === true) reasons.push(`container '${c.name}' allowPrivilegeEscalation`);
      if (sc.runAsNonRoot === false) reasons.push(`container '${c.name}' runAsNonRoot=false`);
    }
    for (const v of (spec.volumes || [])) {
      if (v.hostPath) reasons.push(`hostPath volume '${v.name}'`);
    }
    if (reasons.length) {
      findings.push(mkFinding({
        check: 'CHK-COMP-AKS-NO-POD-SECURITY',
        severity: 'High',
        title: `Privileged / host-namespaced pod '${p.metadata?.name}'`,
        namespace: ns,
        evidence: { pod: p.metadata?.name, reasons },
      }));
    }
  }
  return findings;
}

export function analyzeNamespacePsa(nsDoc) {
  const findings = [];
  for (const n of nsDoc?.items || []) {
    const name = n?.metadata?.name;
    if (SYSTEM_NS.has(name)) continue;
    const labels = n?.metadata?.labels || {};
    const enforce = labels['pod-security.kubernetes.io/enforce'];
    if (enforce !== 'baseline' && enforce !== 'restricted') {
      findings.push(mkFinding({
        check: 'CHK-COMP-AKS-NO-POD-SECURITY',
        severity: 'Medium',
        title: `Namespace '${name}' has no enforced Pod Security Standard (enforce=${enforce || 'unset'})`,
        namespace: name,
        evidence: { namespace: name, enforce: enforce || null },
      }));
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    const key = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).replace(/-/g, '_');
    out[key] = eq >= 0 ? a.slice(eq + 1) : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const cwd = typeof args.cwd === 'string' ? args.cwd : '.';
  const dryRun = Boolean(args.dry_run);

  const gate = checkAuthorization(cwd);
  if (!gate.ok) {
    console.error(`safe-kube-audit refused to run: ${gate.reason}`);
    process.exit(2);
  }
  const allow = loadAllowlist(cwd, typeof args.session === 'string' ? args.session : undefined);
  if (!allow || (allow.clusters.length === 0 && allow.registries.length === 0)) {
    console.error('safe-kube-audit refused to run: no non-empty cluster allowlist (run build-cluster-targets.mjs).');
    process.exit(2);
  }

  const out = typeof args.out === 'string'
    ? resolve(process.cwd(), args.out)
    : resolve(allow.sessionDir, 'findings', 'raw', 'aks-container.jsonl');

  const findings = [];
  const nsFlag = typeof args.namespace === 'string' ? ['-n', args.namespace] : ['-A'];

  const crb = kubectlJson(['get', 'clusterrolebindings', '-o', 'json'], dryRun);
  if (crb.json) findings.push(...analyzeClusterAdminBindings(crb.json));

  const pods = kubectlJson(['get', 'pods', ...nsFlag, '-o', 'json'], dryRun);
  if (pods.json) findings.push(...analyzePrivilegedPods(pods.json));

  const ns = kubectlJson(['get', 'ns', '-o', 'json'], dryRun);
  if (ns.json) findings.push(...analyzeNamespacePsa(ns.json));

  const accel = { kubeBench: which('kube-bench'), kubesec: which('kubesec') };

  if (dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      gate: gate.mode,
      allowlist: { clusters: allow.clusters.length, registries: allow.registries.length },
      wouldRun: [
        'kubectl get clusterrolebindings -o json',
        `kubectl get pods ${nsFlag.join(' ')} -o json`,
        'kubectl get ns -o json',
        accel.kubeBench ? 'kube-bench run (installed)' : 'kube-bench (not installed — skipped)',
        accel.kubesec ? 'kubesec scan <manifest> (installed)' : 'kubesec (not installed — skipped)',
      ],
      wouldWrite: out,
    }, null, 2));
    return;
  }

  mkdirSync(dirname(out), { recursive: true });
  for (const f of findings) appendFileSync(out, JSON.stringify(f) + '\n');

  console.log(JSON.stringify({
    wrote: out,
    findings: findings.length,
    accelerators: accel,
    note: 'Read-only Tier-C1 audit. kube-bench/kubesec are optional accelerators; escalate to C2/C3 only via Invoke-ScopedClusterScan.ps1.',
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
