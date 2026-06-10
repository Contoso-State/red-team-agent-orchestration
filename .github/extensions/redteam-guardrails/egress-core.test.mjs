#!/usr/bin/env node
/**
 * egress-core.test.mjs — unit tests for the EVA scope-lock egress matcher.
 *
 * Run: node .github/extensions/redteam-guardrails/egress-core.test.mjs
 *
 * Dependency-free. Builds throwaway engagement fixtures (engagement.yaml +
 * engagements/.current-session + scope/external-targets.json) in a temp dir and asserts the
 * fail-closed gate behavior. No network, no Azure, no node:sqlite.
 */

import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  probeInvocation,
  parseProbeSegment,
  readExternalTestingConfig,
  loadAllowlist,
  onAllowlist,
  externalTestingGate,
  evaluateEgress,
} from './egress-core.mjs';

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

const ALLOW_HOST = 'app-contoso.azurewebsites.net';
const ALLOW_IP = '20.51.10.20';

function makeEngagement({
  mode = 'external-active-testing',
  enabled = true,
  attested_by = 'Jane Operator',
  attestation_id = 'AUTH-2024-001',
  window_start,
  window_end,
  withAllowlist = true,
  hosts = [ALLOW_HOST],
  ips = [ALLOW_IP],
  session = 'sess-001',
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'eva-egress-'));
  // engagement.yaml
  let yaml = `mode: ${mode}\nexternal_testing:\n  enabled: ${enabled}\n`;
  if (attested_by != null || attestation_id != null) {
    yaml += `  authorization:\n`;
    if (attested_by != null) yaml += `    attested_by: "${attested_by}"\n`;
    if (attestation_id != null) yaml += `    attestation_id: "${attestation_id}"\n`;
    if (window_start) yaml += `    authorized_window_start: "${window_start}"\n`;
    if (window_end) yaml += `    authorized_window_end: "${window_end}"\n`;
  }
  yaml += `scope:\n  domains:\n    - external-vuln\n`;
  writeFileSync(join(root, 'engagement.yaml'), yaml);

  // session marker + allowlist
  const sessDir = join(root, 'engagements', session);
  mkdirSync(join(sessDir, 'scope'), { recursive: true });
  writeFileSync(join(root, 'engagements', '.current-session'), session);
  if (withAllowlist) {
    const doc = {
      schema: 'external-targets/v1',
      engagement_id: 'eng-1',
      allowlist: { hosts, ips },
      content_hash: 'sha256:deadbeef',
      targets: [],
    };
    writeFileSync(join(sessDir, 'scope', 'external-targets.json'), JSON.stringify(doc));
  }
  return { root, sessDir, allowlistPath: join(sessDir, 'scope', 'external-targets.json') };
}

function cleanup(root) {
  try { rmSync(root, { recursive: true, force: true }); } catch {}
}

// ---------------------------------------------------------------------------
// probeInvocation / parseProbeSegment
// ---------------------------------------------------------------------------

ok(probeInvocation('ls -la') === null, 'ls is not a probe');
ok(probeInvocation('az webapp list') === null, 'az is not a probe (handled by read-only matcher)');
ok(probeInvocation('echo curl https://x') === null, 'echo with curl arg is not a probe invocation');

eq(probeInvocation('curl https://example.com')?.tool, 'curl', 'curl recognized');
eq(probeInvocation('CURL https://example.com')?.tool, 'curl', 'curl case-insensitive');
eq(probeInvocation('/usr/bin/wget http://x')?.tool, 'wget', 'path-qualified wget recognized');
eq(probeInvocation('nuclei.exe -u https://x')?.tool, 'nuclei', 'nuclei.exe normalized');
eq(probeInvocation('timeout 30 nuclei -u https://x')?.tool, 'nuclei', 'wrapper timeout skipped');
eq(probeInvocation('env FOO=1 httpx -u https://x')?.tool, 'httpx', 'env var prefix skipped');
eq(probeInvocation('sudo nmap -p80 host')?.tool, 'nmap', 'sudo wrapper skipped');
eq(probeInvocation('Invoke-WebRequest -Uri https://x')?.tool, 'invoke-webrequest', 'iwr recognized');
eq(probeInvocation('& curl https://x')?.tool, 'curl', 'pwsh call operator skipped');

// openssl only counts as a probe when used as a client
ok(probeInvocation('openssl version') === null, 'openssl version is not a probe');
eq(probeInvocation('openssl s_client -connect example.com:443')?.tool, 'openssl', 'openssl s_client is a probe');

// target extraction — public host
{
  const p = parseProbeSegment('curl https://app-contoso.azurewebsites.net/login');
  eq(p.targets, ['app-contoso.azurewebsites.net'], 'curl URL -> public host target');
  eq(p.files, [], 'no list files');
}
{
  const p = parseProbeSegment('nuclei -u https://app.example.com -o out.json -t cves');
  eq(p.targets, ['app.example.com'], '-u flag value is the target');
  eq(p.files, [], '-o output is not a target/file-list');
}
{
  const p = parseProbeSegment('nuclei -l targets.txt');
  eq(p.files, ['targets.txt'], '-l flag value captured as list file');
  eq(p.targets, [], 'no inline targets');
}
{
  const p = parseProbeSegment('httpx --target-file=hosts.txt');
  eq(p.files, ['hosts.txt'], 'inline --target-file= captured');
}
// private / localhost targets are NOT egress
{
  const p = parseProbeSegment('curl http://localhost:8080/health');
  eq(p.targets, [], 'localhost is not external egress');
  eq(p.files, [], 'no files');
}
{
  const p = parseProbeSegment('curl http://10.0.0.5/x');
  eq(p.targets, [], 'RFC1918 is not external egress');
}
{
  const p = parseProbeSegment('curl http://169.254.169.254/metadata');
  eq(p.targets, [], 'link-local IMDS is not external egress');
}
// wordlist positional should not be treated as a target
{
  const p = parseProbeSegment('ffuf -w words.txt -u https://app.example.com/FUZZ');
  eq(p.targets, ['app.example.com'], 'ffuf target via -u');
  ok(!p.targets.includes('words.txt'), 'wordlist not treated as target');
}
// multiple public hosts dedupe / collected
{
  const p = parseProbeSegment('curl https://a.example.com https://b.example.com https://a.example.com');
  eq(p.targets.sort(), ['a.example.com', 'b.example.com'], 'multiple public targets deduped');
}

// ---------------------------------------------------------------------------
// readExternalTestingConfig
// ---------------------------------------------------------------------------
{
  const fx = makeEngagement();
  const cfg = readExternalTestingConfig(fx.root);
  eq(cfg.mode, 'external-active-testing', 'mode parsed');
  eq(cfg.enabled, true, 'enabled parsed');
  eq(cfg.attested_by, 'Jane Operator', 'attested_by parsed');
  eq(cfg.attestation_id, 'AUTH-2024-001', 'attestation_id parsed');
  cleanup(fx.root);
}
{
  const fx = makeEngagement({ enabled: false });
  eq(readExternalTestingConfig(fx.root).enabled, false, 'enabled:false parsed');
  cleanup(fx.root);
}

// ---------------------------------------------------------------------------
// loadAllowlist / onAllowlist
// ---------------------------------------------------------------------------
{
  const fx = makeEngagement();
  const al = loadAllowlist(fx.root);
  ok(al !== null, 'allowlist loaded');
  ok(onAllowlist(ALLOW_HOST, al), 'allowlisted host matches');
  ok(onAllowlist(ALLOW_IP, al), 'allowlisted ip matches');
  ok(!onAllowlist('evil.com', al), 'non-allowlisted host rejected');
  ok(onAllowlist(ALLOW_HOST.toUpperCase(), al), 'host match is case-insensitive');
  cleanup(fx.root);
}
{
  const fx = makeEngagement({ withAllowlist: false });
  eq(loadAllowlist(fx.root), null, 'missing allowlist -> null');
  cleanup(fx.root);
}

// ---------------------------------------------------------------------------
// externalTestingGate
// ---------------------------------------------------------------------------
{
  const fx = makeEngagement();
  eq(externalTestingGate(fx.root).ok, true, 'fully-authorized gate opens');
  cleanup(fx.root);
}
{
  const fx = makeEngagement({ mode: 'read-only-assessment' });
  const g = externalTestingGate(fx.root);
  eq(g.ok, false, 'wrong mode -> gate closed');
  ok(/external-active-testing/.test(g.reason), 'reason mentions required mode');
  cleanup(fx.root);
}
{
  const fx = makeEngagement({ enabled: false });
  eq(externalTestingGate(fx.root).ok, false, 'enabled:false -> gate closed');
  cleanup(fx.root);
}
{
  const fx = makeEngagement({ attestation_id: null });
  const g = externalTestingGate(fx.root);
  eq(g.ok, false, 'missing attestation_id -> gate closed');
  ok(/authorization/.test(g.reason), 'reason mentions authorization');
  cleanup(fx.root);
}
{
  // window in the future
  const future = new Date(Date.now() + 86400000).toISOString();
  const fx = makeEngagement({ window_start: future });
  eq(externalTestingGate(fx.root).ok, false, 'window not started -> gate closed');
  cleanup(fx.root);
}
{
  // window in the past
  const past = new Date(Date.now() - 86400000).toISOString();
  const fx = makeEngagement({ window_end: past });
  eq(externalTestingGate(fx.root).ok, false, 'window expired -> gate closed');
  cleanup(fx.root);
}
{
  const fx = makeEngagement({ withAllowlist: false });
  const g = externalTestingGate(fx.root);
  eq(g.ok, false, 'no allowlist -> gate closed');
  ok(/allowlist/.test(g.reason), 'reason mentions allowlist');
  cleanup(fx.root);
}
{
  const fx = makeEngagement({ hosts: [], ips: [] });
  eq(externalTestingGate(fx.root).ok, false, 'empty allowlist -> gate closed');
  cleanup(fx.root);
}

// ---------------------------------------------------------------------------
// evaluateEgress — the full decision used by the hook
// ---------------------------------------------------------------------------

// Non-probe commands always allowed here
eq(evaluateEgress({ command: 'az webapp list' }, '.').deny, false, 'az command not denied by egress matcher');
eq(evaluateEgress({ command: 'ls -la' }, '.').deny, false, 'ls not denied');
eq(evaluateEgress(null, '.').deny, false, 'null args allowed');

// localhost probe allowed even with no engagement config
eq(evaluateEgress({ command: 'curl http://localhost:3000' }, '.').deny, false, 'localhost probe allowed');

// FULLY AUTHORIZED + on allowlist -> allow
{
  const fx = makeEngagement();
  const d = evaluateEgress({ command: `curl https://${ALLOW_HOST}/login` }, fx.root);
  eq(d.deny, false, 'in-scope probe under full authorization is allowed');
  cleanup(fx.root);
}
{
  const fx = makeEngagement();
  const d = evaluateEgress({ command: `nuclei -u https://${ALLOW_HOST} -t cves` }, fx.root);
  eq(d.deny, false, 'nuclei against allowlisted host allowed');
  cleanup(fx.root);
}
{
  const fx = makeEngagement();
  const d = evaluateEgress({ command: `curl https://${ALLOW_IP}/` }, fx.root);
  eq(d.deny, false, 'allowlisted public IP allowed');
  cleanup(fx.root);
}

// AUTHORIZED but target OFF allowlist -> DENY
{
  const fx = makeEngagement();
  const d = evaluateEgress({ command: 'curl https://evil.example.com/' }, fx.root);
  eq(d.deny, true, 'off-allowlist target denied even when authorized');
  ok(/allowlist/.test(d.reason), 'reason cites allowlist');
  cleanup(fx.root);
}

// Authorized + allowlisted host but ALSO an off-list host in same command -> DENY
{
  const fx = makeEngagement();
  const d = evaluateEgress({ command: `curl https://${ALLOW_HOST} https://evil.com` }, fx.root);
  eq(d.deny, true, 'mixed in/out-of-scope command denied');
  cleanup(fx.root);
}

// In scope target but using a non-allowlist target file -> DENY
{
  const fx = makeEngagement();
  const d = evaluateEgress({ command: 'nuclei -l my-own-targets.txt' }, fx.root);
  eq(d.deny, true, 'arbitrary target-list file denied');
  ok(/target-list/.test(d.reason), 'reason cites target-list file');
  cleanup(fx.root);
}

// Using the actual allowlist file as the target list -> allow
{
  const fx = makeEngagement();
  const d = evaluateEgress({ command: `nuclei -l ${fx.allowlistPath}` }, fx.root);
  eq(d.deny, false, 'using the engagement allowlist file as target list is allowed');
  cleanup(fx.root);
}

// A plain host-list file whose contents are all in-scope -> allow (generated by wrapper)
{
  const fx = makeEngagement();
  const hostsFile = join(fx.sessDir, 'scope', 'targets.hosts.txt');
  writeFileSync(hostsFile, `# generated\n${ALLOW_HOST}\n${ALLOW_IP}\n`);
  const d = evaluateEgress({ command: `nuclei -l ${hostsFile}` }, fx.root);
  eq(d.deny, false, 'in-scope host-list file is allowed');
  cleanup(fx.root);
}

// A host-list file containing an out-of-scope host -> DENY
{
  const fx = makeEngagement();
  const hostsFile = join(fx.sessDir, 'scope', 'targets.hosts.txt');
  writeFileSync(hostsFile, `${ALLOW_HOST}\nevil.example.com\n`);
  const d = evaluateEgress({ command: `nuclei -l ${hostsFile}` }, fx.root);
  eq(d.deny, true, 'host-list file with an out-of-scope host is denied');
  ok(/out-of-scope/.test(d.reason), 'reason cites out-of-scope host');
  cleanup(fx.root);
}

// Public probe but engagement is read-only -> DENY (the spine)
{
  const fx = makeEngagement({ mode: 'read-only-assessment' });
  const d = evaluateEgress({ command: `curl https://${ALLOW_HOST}/` }, fx.root);
  eq(d.deny, true, 'public probe in read-only mode denied');
  cleanup(fx.root);
}

// Public probe with NO engagement.yaml at all -> DENY (fail closed)
{
  const root = mkdtempSync(join(tmpdir(), 'eva-egress-bare-'));
  const d = evaluateEgress({ command: 'curl https://app-contoso.azurewebsites.net/' }, root);
  eq(d.deny, true, 'public probe with no engagement config fails closed');
  cleanup(root);
}

// Obfuscated via pwsh -Command should still be inspected (gatherCommandTexts unwraps it)
{
  const fx = makeEngagement();
  const d = evaluateEgress(
    { command: `pwsh -Command "curl https://evil.com/x"` },
    fx.root
  );
  eq(d.deny, true, 'probe hidden in pwsh -Command is still gated');
  cleanup(fx.root);
}

console.log(`OK \u2014 ${passed} egress-core assertions passed`);
