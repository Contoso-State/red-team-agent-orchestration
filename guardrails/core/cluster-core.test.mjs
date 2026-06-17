#!/usr/bin/env node
/**
 * cluster-core.test.mjs — unit tests for the cluster-active scope-lock matcher.
 *
 * Run: node .github/extensions/redteam-guardrails/cluster-core.test.mjs
 *
 * Dependency-free. Builds throwaway engagement fixtures (engagement.yaml +
 * engagements/.current-session + scope/cluster-targets.json) in a temp dir and asserts the
 * fail-closed gate behavior. No network, no Azure, no node:sqlite.
 */

import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clusterInvocation,
  classifyClusterSegment,
  extractImageRefs,
  extractKubectlSelectors,
  hasKubectlClusterSelector,
  kubectlTargetsAllowlistedCluster,
  readClusterTestingConfig,
  loadClusterAllowlist,
  registryOnAllowlist,
  clusterTestingGate,
  evaluateCluster,
} from './cluster-core.mjs';

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
}
function eq(a, b, msg) {
  assert.deepStrictEqual(a, b, msg);
  passed++;
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const ALLOW_CLUSTER = 'aks-contoso';
const ALLOW_REGISTRY = 'contosoacr.azurecr.io';

function makeEngagement({
  mode = 'cluster-active-testing',
  enabled = true,
  attested_by = 'Jane Operator',
  attestation_id = 'AUTH-2024-009',
  window_start,
  window_end,
  withAllowlist = true,
  clusters = [ALLOW_CLUSTER],
  registries = [ALLOW_REGISTRY],
  session = 'sess-c1',
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aks-cluster-'));
  let yaml = `mode: ${mode}\ncluster_testing:\n  enabled: ${enabled}\n`;
  if (attested_by != null || attestation_id != null) {
    yaml += `  authorization:\n`;
    if (attested_by != null) yaml += `    attested_by: "${attested_by}"\n`;
    if (attestation_id != null) yaml += `    attestation_id: "${attestation_id}"\n`;
    if (window_start) yaml += `    authorized_window_start: "${window_start}"\n`;
    if (window_end) yaml += `    authorized_window_end: "${window_end}"\n`;
  }
  yaml += `scope:\n  domains:\n    - aks-container\n`;
  writeFileSync(join(root, 'engagement.yaml'), yaml);

  const sessDir = join(root, 'engagements', session);
  mkdirSync(join(sessDir, 'scope'), { recursive: true });
  writeFileSync(join(root, 'engagements', '.current-session'), session);
  if (withAllowlist) {
    const doc = {
      schema: 'cluster-targets/v1',
      engagement_id: 'eng-1',
      allowlist: { clusters, registries },
      content_hash: 'sha256:cafef00d',
      targets: [],
    };
    writeFileSync(join(sessDir, 'scope', 'cluster-targets.json'), JSON.stringify(doc));
  }
  return { root, sessDir, allowlistPath: join(sessDir, 'scope', 'cluster-targets.json') };
}

function cleanup(root) {
  try { rmSync(root, { recursive: true, force: true }); } catch {}
}

// ---------------------------------------------------------------------------
// clusterInvocation — tool recognition + wrapper skipping
// ---------------------------------------------------------------------------

ok(clusterInvocation('ls -la') === null, 'ls is not a cluster tool');
ok(clusterInvocation('az aks list') === null, 'az is not governed by cluster-core');
ok(clusterInvocation('echo kubectl get pods') === null, 'echo with kubectl arg is not an invocation');
eq(clusterInvocation('kubectl get pods')?.tool, 'kubectl', 'kubectl recognized');
eq(clusterInvocation('/usr/bin/kubectl get ns')?.tool, 'kubectl', 'path-qualified kubectl recognized');
eq(clusterInvocation('timeout 60 kube-bench run')?.tool, 'kube-bench', 'wrapper timeout skipped');
eq(clusterInvocation('sudo trivy image x')?.tool, 'trivy', 'sudo wrapper skipped');
eq(clusterInvocation('env FOO=1 grype x')?.tool, 'grype', 'env var prefix skipped');
eq(clusterInvocation('& kubectl get pods')?.tool, 'kubectl', 'pwsh call operator skipped');
eq(clusterInvocation('docker ps')?.tool, 'docker', 'docker recognized');
eq(clusterInvocation('helm list')?.tool, 'helm', 'helm recognized');

// ---------------------------------------------------------------------------
// classifyClusterSegment — per-segment classification (no gate)
// ---------------------------------------------------------------------------

// read-only kubectl -> allow
for (const c of [
  'kubectl get pods -A',
  'kubectl describe pod x -n ns',
  'kubectl logs mypod',
  'kubectl top nodes',
  'kubectl version',
  'kubectl explain pod',
  'kubectl api-resources',
  'kubectl cluster-info',
  'kubectl config view',
  'kubectl auth can-i --list',
  'kubectl --context foo get pods', // global flag before verb
  'kubectl -n kube-system get pods',
]) {
  eq(classifyClusterSegment(c)?.kind, 'allow', `read-only allowed: ${c}`);
}

// mutating kubectl -> deny in all modes
for (const c of [
  'kubectl apply -f x.yaml',
  'kubectl create deployment web --image=nginx',
  'kubectl delete pod x',
  'kubectl patch deploy web -p {}',
  'kubectl edit svc web',
  'kubectl scale deploy web --replicas=3',
  'kubectl drain node1',
  'kubectl cordon node1',
  'kubectl label pod x a=b',
  'kubectl auth reconcile -f rbac.yaml',
  'kubectl rollout restart deploy/web',
  'kubectl rollout undo deploy/web',
]) {
  eq(classifyClusterSegment(c)?.kind, 'deny', `mutating denied: ${c}`);
}

// rollout status/history are read-only
eq(classifyClusterSegment('kubectl rollout status deploy/web')?.kind, 'allow', 'rollout status allowed');
eq(classifyClusterSegment('kubectl rollout history deploy/web')?.kind, 'allow', 'rollout history allowed');

// gated kubectl verbs
for (const c of [
  'kubectl exec -it pod -- sh',
  'kubectl debug node/n1 -it',
  'kubectl cp pod:/etc/passwd ./p',
  'kubectl attach pod',
  'kubectl port-forward pod 8080:80',
  'kubectl run tmp --image=busybox',
  'kubectl proxy',
]) {
  eq(classifyClusterSegment(c)?.kind, 'gated', `reach-into-cluster gated: ${c}`);
}

// unknown kubectl verb fails closed
eq(classifyClusterSegment('kubectl frobnicate x')?.kind, 'deny', 'unknown kubectl verb fails closed');

// helm
eq(classifyClusterSegment('helm list -A')?.kind, 'allow', 'helm list allowed');
eq(classifyClusterSegment('helm get values rel')?.kind, 'allow', 'helm get allowed');
eq(classifyClusterSegment('helm install rel chart')?.kind, 'deny', 'helm install denied');
eq(classifyClusterSegment('helm upgrade rel chart')?.kind, 'deny', 'helm upgrade denied');

// container runtimes
eq(classifyClusterSegment('docker ps')?.kind, 'allow', 'docker ps allowed');
eq(classifyClusterSegment('docker images')?.kind, 'allow', 'docker images allowed');
eq(classifyClusterSegment('docker inspect x')?.kind, 'allow', 'docker inspect allowed');
eq(classifyClusterSegment('docker run -it x sh')?.kind, 'gated', 'docker run gated');
eq(classifyClusterSegment('docker exec -it x sh')?.kind, 'gated', 'docker exec gated');
eq(classifyClusterSegment('podman pull x')?.kind, 'gated', 'podman pull gated');

// standalone active tools always gated
for (const c of ['kube-bench run', 'kubesec scan x.yaml', 'trivy image x', 'grype x', 'crictl ps']) {
  eq(classifyClusterSegment(c)?.kind, 'gated', `standalone gated: ${c}`);
}

// non-cluster commands -> null
ok(classifyClusterSegment('az aks list') === null, 'az not classified');
ok(classifyClusterSegment('curl https://x') === null, 'curl not classified by cluster-core');

// ---------------------------------------------------------------------------
// extractImageRefs
// ---------------------------------------------------------------------------

eq(
  extractImageRefs('trivy image contosoacr.azurecr.io/web@sha256:abc'.split(/\s+/)),
  ['contosoacr.azurecr.io'],
  'extracts azurecr.io registry host',
);
eq(extractImageRefs('trivy image nginx:latest'.split(/\s+/)), [], 'no azurecr host -> none');
eq(extractImageRefs('trivy fs ./dir'.split(/\s+/)), [], 'filesystem scan -> none');

// ---------------------------------------------------------------------------
// registryOnAllowlist
// ---------------------------------------------------------------------------

{
  const al = { registries: new Set(['contosoacr.azurecr.io']) };
  ok(registryOnAllowlist('contosoacr.azurecr.io', al), 'exact registry match');
  ok(registryOnAllowlist('CONTOSOACR.AZURECR.IO', al), 'registry match case-insensitive');
  ok(!registryOnAllowlist('evil.azurecr.io', al), 'off-list registry rejected');
}
{
  const al = { registries: new Set(['contosoacr']) }; // short name form
  ok(registryOnAllowlist('contosoacr.azurecr.io', al), 'short-name allowlist matches FQDN');
}

// ---------------------------------------------------------------------------
// readClusterTestingConfig / loadClusterAllowlist / clusterTestingGate
// ---------------------------------------------------------------------------

{
  const fx = makeEngagement();
  const cfg = readClusterTestingConfig(fx.root);
  eq(cfg.mode, 'cluster-active-testing', 'mode parsed');
  eq(cfg.enabled, true, 'enabled parsed');
  eq(cfg.attested_by, 'Jane Operator', 'attested_by parsed');
  eq(cfg.attestation_id, 'AUTH-2024-009', 'attestation_id parsed');
  const al = loadClusterAllowlist(fx.root);
  ok(al && al.clusters.has('aks-contoso'), 'allowlist clusters loaded');
  ok(al && al.registries.has('contosoacr.azurecr.io'), 'allowlist registries loaded');
  eq(clusterTestingGate(fx.root).ok, true, 'fully authorized -> gate open');
  cleanup(fx.root);
}
{
  const fx = makeEngagement({ mode: 'read-only-assessment' });
  const g = clusterTestingGate(fx.root);
  eq(g.ok, false, 'wrong mode -> gate closed');
  ok(/cluster-active-testing/.test(g.reason), 'reason cites required mode');
  cleanup(fx.root);
}
{
  const fx = makeEngagement({ enabled: false });
  eq(clusterTestingGate(fx.root).ok, false, 'disabled -> gate closed');
  cleanup(fx.root);
}
{
  const fx = makeEngagement({ attestation_id: null });
  eq(clusterTestingGate(fx.root).ok, false, 'missing attestation -> gate closed');
  cleanup(fx.root);
}
{
  const future = new Date(Date.now() + 86400000).toISOString();
  const fx = makeEngagement({ window_start: future });
  eq(clusterTestingGate(fx.root).ok, false, 'window not started -> gate closed');
  cleanup(fx.root);
}
{
  const past = new Date(Date.now() - 86400000).toISOString();
  const fx = makeEngagement({ window_end: past });
  eq(clusterTestingGate(fx.root).ok, false, 'window expired -> gate closed');
  cleanup(fx.root);
}
{
  const fx = makeEngagement({ withAllowlist: false });
  const g = clusterTestingGate(fx.root);
  eq(g.ok, false, 'no allowlist -> gate closed');
  ok(/allowlist/.test(g.reason), 'reason mentions allowlist');
  cleanup(fx.root);
}
{
  const fx = makeEngagement({ clusters: [], registries: [] });
  eq(clusterTestingGate(fx.root).ok, false, 'empty allowlist -> gate closed');
  cleanup(fx.root);
}

// ---------------------------------------------------------------------------
// evaluateCluster — the full decision used by the hook
// ---------------------------------------------------------------------------

// Non-cluster + read-only commands always allowed here
eq(evaluateCluster({ command: 'az aks list' }, '.').deny, false, 'az command not denied by cluster matcher');
eq(evaluateCluster({ command: 'kubectl get pods -A' }, '.').deny, false, 'read-only kubectl allowed without config');
eq(evaluateCluster(null, '.').deny, false, 'null args allowed');

// Mutating kubectl denied even with NO engagement config (read-only posture is absolute)
{
  const d = evaluateCluster({ command: 'kubectl delete pod x' }, '.');
  eq(d.deny, true, 'mutating kubectl denied regardless of mode');
  ok(/read-only/.test(d.reason), 'reason cites read-only posture');
}

// Mutating kubectl denied even under a fully authorized cluster-active engagement
{
  const fx = makeEngagement();
  eq(evaluateCluster({ command: 'kubectl apply -f x.yaml' }, fx.root).deny, true, 'apply denied even when gated lane is open');
  cleanup(fx.root);
}

// Gated tool with NO engagement config -> DENY (fail closed)
{
  const root = mkdtempSync(join(tmpdir(), 'aks-bare-'));
  const d = evaluateCluster({ command: 'kube-bench run' }, root);
  eq(d.deny, true, 'gated tool with no config fails closed');
  cleanup(root);
}

// Gated tool in read-only mode -> DENY
{
  const fx = makeEngagement({ mode: 'read-only-assessment' });
  eq(evaluateCluster({ command: 'kubectl exec -it pod -- id' }, fx.root).deny, true, 'kubectl exec denied in read-only mode');
  cleanup(fx.root);
}

// Fully authorized -> standalone gated tool allowed; kubectl reach-in must target in-scope cluster
{
  const fx = makeEngagement();
  eq(evaluateCluster({ command: 'kube-bench run' }, fx.root).deny, false, 'kube-bench allowed under full authorization');
  eq(
    evaluateCluster({ command: `kubectl --context ${ALLOW_CLUSTER} exec -it pod -- id` }, fx.root).deny,
    false,
    'kubectl exec allowed when it targets the in-scope cluster',
  );
  eq(
    evaluateCluster({ command: `kubectl exec -it pod --context=${ALLOW_CLUSTER} -- id` }, fx.root).deny,
    false,
    'kubectl exec allowed with --context= form after positional args',
  );
  cleanup(fx.root);
}

// Reach-into-cluster kubectl with NO cluster selector -> DENY even when fully authorized
{
  const fx = makeEngagement();
  const d = evaluateCluster({ command: 'kubectl exec -it pod -- id' }, fx.root);
  eq(d.deny, true, 'kubectl exec without --context denied (current-context not trusted)');
  ok(/does not name a target cluster/.test(d.reason), 'reason explains the missing cluster selector');
  cleanup(fx.root);
}

// Reach-into-cluster kubectl targeting an OFF-allowlist cluster -> DENY
{
  const fx = makeEngagement();
  const d = evaluateCluster({ command: 'kubectl --context not-in-scope exec -it pod -- id' }, fx.root);
  eq(d.deny, true, 'kubectl exec against an off-allowlist context denied');
  ok(/not on the Azure-derived cluster allowlist/.test(d.reason), 'reason cites the cluster allowlist');
  cleanup(fx.root);
}

// debug / cp are likewise scope-locked to the cluster selector
{
  const fx = makeEngagement();
  eq(evaluateCluster({ command: 'kubectl debug node/n1 -it' }, fx.root).deny, true, 'kubectl debug without context denied');
  eq(
    evaluateCluster({ command: `kubectl --context ${ALLOW_CLUSTER} cp pod:/etc/hosts ./h` }, fx.root).deny,
    false,
    'kubectl cp allowed against the in-scope cluster',
  );
  cleanup(fx.root);
}

// extractKubectlSelectors / matchers (unit)
eq(extractKubectlSelectors('kubectl --context Aks-Contoso exec p -- sh'.split(/\s+/)).context, 'aks-contoso', 'context lowercased');
eq(extractKubectlSelectors('kubectl exec p --cluster=c1 -- sh'.split(/\s+/)).cluster, 'c1', '--cluster= parsed');
eq(extractKubectlSelectors('kubectl exec p -- sh --context evil'.split(/\s+/)).context, undefined, 'selectors after -- are ignored');
ok(!hasKubectlClusterSelector(extractKubectlSelectors('kubectl exec p -- sh'.split(/\s+/))), 'no selector detected');
{
  const al = { clusters: new Set(['aks-contoso']) };
  ok(kubectlTargetsAllowlistedCluster({ context: 'aks-contoso' }, al), 'context on allowlist matches');
  ok(!kubectlTargetsAllowlistedCluster({ context: 'other' }, al), 'off-list context rejected');
}

// Image scan: in-scope registry allowed, out-of-scope registry denied
{
  const fx = makeEngagement();
  eq(
    evaluateCluster({ command: `trivy image ${ALLOW_REGISTRY}/web@sha256:abc` }, fx.root).deny,
    false,
    'in-scope ACR image allowed',
  );
  const d = evaluateCluster({ command: 'trivy image evilacr.azurecr.io/web:latest' }, fx.root);
  eq(d.deny, true, 'out-of-scope ACR image denied');
  ok(/not on the Azure-derived cluster allowlist/.test(d.reason), 'reason cites allowlist');
  cleanup(fx.root);
}

// Obfuscated via pwsh -Command should still be inspected (gatherCommandTexts unwraps it)
{
  const fx = makeEngagement({ mode: 'read-only-assessment' });
  const d = evaluateCluster({ command: `pwsh -Command "kubectl exec -it pod -- id"` }, fx.root);
  eq(d.deny, true, 'gated tool hidden in pwsh -Command is still gated');
  cleanup(fx.root);
}

console.log(`OK \u2014 ${passed} cluster-core assertions passed`);
