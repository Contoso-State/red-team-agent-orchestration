#!/usr/bin/env node
/**
 * safe-prober.mjs — Tier-1 ("safe-active") benign external prober for the External
 * Vulnerability Agent (EVA).
 *
 * Performs a *small, polite* set of read-only HTTP(S)/TLS requests against the in-scope
 * Azure-derived targets and reports common web hygiene issues mapped to OWASP/CWE:
 *   - missing security response headers (HSTS, CSP, X-Content-Type-Options, ...)
 *   - server / framework version disclosure
 *   - insecure cookie flags (Secure / HttpOnly / SameSite)
 *   - permissive CORS (ACAO: * or reflected origin)
 *   - risky HTTP methods enabled (PUT/DELETE/TRACE/CONNECT)
 *   - weak TLS version / certificate near expiry
 *   - plaintext HTTP reachable / no HTTPS redirect
 *
 * Scope lock (defense in depth — the redteam-guardrails egress hook enforces this too):
 *   - Targets are taken ONLY from engagements/<session>/scope/external-targets.json.
 *   - It refuses to run at all unless externalTestingGate() passes (mode
 *     external-active-testing + external_testing enabled + authorized + allowlist present).
 *   - There is NO CLI option to pass an arbitrary target.
 *
 * Tier-1 only: GET/HEAD/OPTIONS to the site root (+ an optional tiny well-known path set).
 * No fuzzing, no injection, no auth attacks. Dependency-free (global fetch + node:tls).
 *
 * CLI:
 *   node tools/external/safe-prober.mjs [--cwd <repoRoot>] [--out <file.jsonl>]
 *        [--timeout-ms 10000] [--rate-per-second 2] [--max-targets 0] [--json]
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect as tlsConnect } from 'node:tls';
import { externalTestingGate } from '../../guardrails/core/egress-core.mjs';

// ---------------------------------------------------------------------------
// Pure analyzers (no network) — unit-tested in safe-prober.test.mjs
// ---------------------------------------------------------------------------

export const SECURITY_HEADERS = [
  { name: 'strict-transport-security', label: 'HSTS (Strict-Transport-Security)', severity: 'medium', cwe: 'CWE-319' },
  { name: 'content-security-policy', label: 'Content-Security-Policy', severity: 'medium', cwe: 'CWE-1021' },
  { name: 'x-content-type-options', label: 'X-Content-Type-Options', severity: 'low', cwe: 'CWE-693' },
  { name: 'x-frame-options', label: 'X-Frame-Options', severity: 'low', cwe: 'CWE-1021' },
  { name: 'referrer-policy', label: 'Referrer-Policy', severity: 'low', cwe: 'CWE-200' },
  { name: 'permissions-policy', label: 'Permissions-Policy', severity: 'info', cwe: 'CWE-693' },
];

const DISCLOSURE_HEADERS = [
  { name: 'server', label: 'Server' },
  { name: 'x-powered-by', label: 'X-Powered-By' },
  { name: 'x-aspnet-version', label: 'X-AspNet-Version' },
  { name: 'x-aspnetmvc-version', label: 'X-AspNetMvc-Version' },
  { name: 'x-generator', label: 'X-Generator' },
];

const RISKY_METHODS = ['PUT', 'DELETE', 'TRACE', 'CONNECT', 'PATCH'];

/** Normalize a fetch Headers object (or plain object) into a lowercase-keyed plain object. */
export function normalizeHeaders(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === 'function' && !Array.isArray(headers)) {
    headers.forEach((v, k) => { out[String(k).toLowerCase()] = v; });
    return out;
  }
  for (const [k, v] of Object.entries(headers)) out[String(k).toLowerCase()] = v;
  return out;
}

/** Findings for missing security response headers. Only meaningful on a successful response. */
export function analyzeSecurityHeaders(headers) {
  const h = normalizeHeaders(headers);
  const findings = [];
  for (const def of SECURITY_HEADERS) {
    if (!(def.name in h) || !String(h[def.name]).trim()) {
      findings.push({
        check: 'CHK-EVA-001',
        severity: def.severity,
        title: `Missing response header: ${def.label}`,
        evidence: `Response did not include a ${def.label} header.`,
        recommendation: `Add the ${def.label} header to harden the response.`,
        owasp: 'A05:2021-Security Misconfiguration',
        cwe: def.cwe,
      });
    }
  }
  return findings;
}

/** Findings for server / framework version disclosure. */
export function analyzeServerDisclosure(headers) {
  const h = normalizeHeaders(headers);
  const findings = [];
  for (const def of DISCLOSURE_HEADERS) {
    const val = h[def.name];
    if (!val) continue;
    // A bare product name (e.g. "nginx", "Kestrel") is low-signal; a version is the concern.
    const hasVersion = /\d/.test(String(val));
    findings.push({
      check: 'CHK-EVA-002',
      severity: hasVersion ? 'low' : 'info',
      title: `Technology disclosure via ${def.label} header`,
      evidence: `${def.label}: ${val}`,
      recommendation: `Suppress or genericize the ${def.label} header to reduce fingerprinting.`,
      owasp: 'A05:2021-Security Misconfiguration',
      cwe: 'CWE-200',
    });
  }
  return findings;
}

/** Findings for insecure cookie flags. `setCookies` is an array of raw Set-Cookie strings. */
export function analyzeCookies(setCookies) {
  const findings = [];
  for (const raw of setCookies || []) {
    const parts = String(raw).split(';').map((s) => s.trim());
    const nameVal = parts[0] || '';
    const name = nameVal.split('=')[0] || '(unnamed)';
    const flags = parts.slice(1).map((p) => p.toLowerCase());
    const missing = [];
    if (!flags.includes('secure')) missing.push('Secure');
    if (!flags.includes('httponly')) missing.push('HttpOnly');
    if (!flags.some((f) => f.startsWith('samesite'))) missing.push('SameSite');
    if (missing.length) {
      findings.push({
        check: 'CHK-EVA-003',
        severity: missing.includes('Secure') || missing.includes('HttpOnly') ? 'medium' : 'low',
        title: `Cookie '${name}' missing flags: ${missing.join(', ')}`,
        evidence: `Set-Cookie: ${raw}`,
        recommendation: `Set ${missing.join(', ')} on cookie '${name}'.`,
        owasp: 'A05:2021-Security Misconfiguration',
        cwe: 'CWE-1004',
      });
    }
  }
  return findings;
}

/**
 * Findings for permissive CORS. `reflectedProbeOrigin` is the random Origin sent on a probe
 * request; if the server reflects it (or returns `*`) with credentials, that's a finding.
 */
export function analyzeCors(headers, reflectedProbeOrigin) {
  const h = normalizeHeaders(headers);
  const acao = h['access-control-allow-origin'];
  if (!acao) return [];
  const acac = String(h['access-control-allow-credentials'] || '').toLowerCase() === 'true';
  const findings = [];
  if (acao === '*') {
    findings.push({
      check: 'CHK-EVA-004',
      severity: acac ? 'high' : 'low',
      title: acac
        ? 'CORS allows any origin (*) with credentials'
        : 'CORS allows any origin (*)',
      evidence: `Access-Control-Allow-Origin: *${acac ? '; Access-Control-Allow-Credentials: true' : ''}`,
      recommendation: 'Restrict Access-Control-Allow-Origin to a specific trusted origin allowlist.',
      owasp: 'A05:2021-Security Misconfiguration',
      cwe: 'CWE-942',
    });
  } else if (reflectedProbeOrigin && acao === reflectedProbeOrigin) {
    findings.push({
      check: 'CHK-EVA-004',
      severity: acac ? 'high' : 'medium',
      title: 'CORS reflects arbitrary request Origin',
      evidence: `Sent Origin: ${reflectedProbeOrigin} -> Access-Control-Allow-Origin: ${acao}${acac ? '; Allow-Credentials: true' : ''}`,
      recommendation: 'Do not reflect the request Origin; validate against a fixed allowlist.',
      owasp: 'A05:2021-Security Misconfiguration',
      cwe: 'CWE-942',
    });
  }
  return findings;
}

/** Findings for risky HTTP methods advertised in an Allow / Public header. */
export function analyzeMethods(allowHeader) {
  if (!allowHeader) return [];
  const methods = String(allowHeader).split(',').map((m) => m.trim().toUpperCase()).filter(Boolean);
  const risky = methods.filter((m) => RISKY_METHODS.includes(m));
  if (!risky.length) return [];
  return [{
    check: 'CHK-EVA-005',
    severity: risky.includes('PUT') || risky.includes('DELETE') ? 'medium' : 'low',
    title: `Risky HTTP methods enabled: ${risky.join(', ')}`,
    evidence: `Allow: ${allowHeader}`,
    recommendation: `Disable unused HTTP methods (${risky.join(', ')}) at the web server / app.`,
    owasp: 'A05:2021-Security Misconfiguration',
    cwe: 'CWE-650',
  }];
}

/** Findings for weak TLS protocol or a certificate near/at expiry. */
export function analyzeTls({ protocol, daysToExpiry } = {}) {
  const findings = [];
  if (protocol && /^(SSLv|TLSv1(\.0|\.1)?$)/i.test(protocol) && !/TLSv1\.[23]/i.test(protocol)) {
    findings.push({
      check: 'CHK-EVA-006',
      severity: 'medium',
      title: `Weak TLS protocol negotiated: ${protocol}`,
      evidence: `Negotiated protocol ${protocol}.`,
      recommendation: 'Require TLS 1.2+ and disable legacy protocols.',
      owasp: 'A02:2021-Cryptographic Failures',
      cwe: 'CWE-326',
    });
  }
  if (typeof daysToExpiry === 'number') {
    if (daysToExpiry < 0) {
      findings.push({
        check: 'CHK-EVA-006',
        severity: 'high',
        title: 'TLS certificate is expired',
        evidence: `Certificate expired ${Math.abs(daysToExpiry)} day(s) ago.`,
        recommendation: 'Renew the TLS certificate immediately.',
        owasp: 'A02:2021-Cryptographic Failures',
        cwe: 'CWE-298',
      });
    } else if (daysToExpiry <= 14) {
      findings.push({
        check: 'CHK-EVA-006',
        severity: 'medium',
        title: 'TLS certificate expiring soon',
        evidence: `Certificate expires in ${daysToExpiry} day(s).`,
        recommendation: 'Renew the TLS certificate before it expires.',
        owasp: 'A02:2021-Cryptographic Failures',
        cwe: 'CWE-298',
      });
    }
  }
  return findings;
}

/** Finding when plaintext HTTP is reachable and does not redirect to HTTPS. */
export function analyzeHttpRedirect({ httpStatus, redirectsToHttps } = {}) {
  if (httpStatus == null) return [];
  if (httpStatus >= 200 && httpStatus < 400 && !redirectsToHttps) {
    return [{
      check: 'CHK-EVA-007',
      severity: 'medium',
      title: 'Plaintext HTTP reachable without redirect to HTTPS',
      evidence: `HTTP request returned ${httpStatus} and did not redirect to HTTPS.`,
      recommendation: 'Force an HTTP->HTTPS redirect (and set HSTS).',
      owasp: 'A02:2021-Cryptographic Failures',
      cwe: 'CWE-319',
    }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Network probes (Tier-1, benign). Isolated so tests never hit the network.
// ---------------------------------------------------------------------------

const PROBE_ORIGIN = 'https://eva-cors-probe.invalid';

async function httpRequest(url, { method = 'GET', timeoutMs = 10000, headers = {} } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'manual',
      signal: ac.signal,
      headers: { 'User-Agent': 'EVA-SafeProber/1.0 (+azure-redteam)', ...headers },
    });
    const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    return { status: res.status, headers: normalizeHeaders(res.headers), setCookie, location: res.headers.get('location') };
  } finally {
    clearTimeout(t);
  }
}

function tlsInfo(host, port = 443, timeoutMs = 10000) {
  return new Promise((res) => {
    let done = false;
    const finish = (val) => { if (!done) { done = true; try { socket.destroy(); } catch {} res(val); } };
    const socket = tlsConnect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const protocol = socket.getProtocol();
      const cert = socket.getPeerCertificate();
      let daysToExpiry;
      if (cert && cert.valid_to) {
        const exp = Date.parse(cert.valid_to);
        if (!Number.isNaN(exp)) daysToExpiry = Math.floor((exp - Date.now()) / 86400000);
      }
      finish({ protocol, daysToExpiry, authorized: socket.authorized });
    });
    socket.on('error', () => finish(null));
    socket.on('timeout', () => finish(null));
  });
}

/** Probe a single target host and return an array of finding fragments. */
export async function probeTarget(host, { timeoutMs = 10000 } = {}) {
  const findings = [];
  const httpsUrl = `https://${host}/`;

  // HTTPS GET — security headers, disclosure, cookies, CORS
  try {
    const get = await httpRequest(httpsUrl, { timeoutMs, headers: { Origin: PROBE_ORIGIN } });
    findings.push(...analyzeSecurityHeaders(get.headers));
    findings.push(...analyzeServerDisclosure(get.headers));
    findings.push(...analyzeCookies(get.setCookie));
    findings.push(...analyzeCors(get.headers, PROBE_ORIGIN));
  } catch { /* host may be IP-only / non-HTTPS; TLS + HTTP checks below still run */ }

  // OPTIONS — advertised methods
  try {
    const opt = await httpRequest(httpsUrl, { method: 'OPTIONS', timeoutMs });
    findings.push(...analyzeMethods(opt.headers['allow'] || opt.headers['public']));
  } catch { /* OPTIONS not supported */ }

  // TLS — protocol + cert expiry
  try {
    const tls = await tlsInfo(host, 443, timeoutMs);
    if (tls) findings.push(...analyzeTls(tls));
  } catch { /* not TLS-capable */ }

  // Plaintext HTTP reachable without HTTPS redirect
  try {
    const http = await httpRequest(`http://${host}/`, { method: 'HEAD', timeoutMs });
    const loc = http.location || '';
    const redirectsToHttps = http.status >= 300 && http.status < 400 && /^https:/i.test(loc);
    findings.push(...analyzeHttpRedirect({ httpStatus: http.status, redirectsToHttps }));
  } catch { /* HTTP not reachable — fine */ }

  return findings;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function loadTargetsDoc(allowlistPath) {
  try {
    return JSON.parse(readFileSync(allowlistPath, 'utf8'));
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runProber(cwd, opts = {}) {
  const gate = externalTestingGate(cwd);
  if (!gate.ok) {
    return { ok: false, reason: gate.reason, findings: [] };
  }
  const doc = loadTargetsDoc(gate.allowlist.path);
  let targets = [];
  if (doc && Array.isArray(doc.targets) && doc.targets.length) {
    targets = doc.targets.map((t) => ({ host: t.host, url: t.url }));
  } else {
    targets = [...gate.allowlist.hosts, ...gate.allowlist.ips].map((h) => ({ host: h }));
  }
  if (opts.maxTargets && opts.maxTargets > 0) targets = targets.slice(0, opts.maxTargets);

  const ratePerSecond = opts.ratePerSecond || 2;
  const gapMs = Math.max(0, Math.floor(1000 / ratePerSecond));
  const timeoutMs = opts.timeoutMs || 10000;
  const observedAt = new Date().toISOString();

  const findings = [];
  let seq = 0;
  for (const t of targets) {
    const frags = await probeTarget(t.host, { timeoutMs });
    for (const f of frags) {
      seq += 1;
      findings.push({
        id: `AZ-EVA-${String(seq).padStart(3, '0')}`,
        agent: 'external-vuln',
        tier: 'safe-active',
        target: t.host,
        url: t.url || `https://${t.host}/`,
        observed_at: observedAt,
        ...f,
      });
    }
    if (gapMs) await sleep(gapMs);
  }
  return { ok: true, findings, targetCount: targets.length, source: gate.allowlist.path };
}

function parseArgs(argv) {
  const o = { cwd: '.', timeoutMs: 10000, ratePerSecond: 2, maxTargets: 0, out: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd') o.cwd = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--timeout-ms') o.timeoutMs = Number(argv[++i]);
    else if (a === '--rate-per-second') o.ratePerSecond = Number(argv[++i]);
    else if (a === '--max-targets') o.maxTargets = Number(argv[++i]);
    else if (a === '--json') o.json = true;
  }
  return o;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const result = await runProber(opts.cwd, opts);
  if (!result.ok) {
    console.error(`safe-prober refused to run: ${result.reason}`);
    process.exit(2);
  }
  if (opts.out) {
    mkdirSync(dirname(resolve(opts.out)), { recursive: true });
    const lines = result.findings.map((f) => JSON.stringify(f)).join('\n');
    writeFileSync(resolve(opts.out), lines ? lines + '\n' : '');
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(result.findings, null, 2) + '\n');
  } else {
    const bySev = {};
    for (const f of result.findings) bySev[f.severity] = (bySev[f.severity] || 0) + 1;
    console.log(
      `safe-prober: ${result.findings.length} findings across ${result.targetCount} in-scope target(s)` +
      (Object.keys(bySev).length ? ` (${Object.entries(bySev).map(([k, v]) => `${k}:${v}`).join(', ')})` : '')
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err?.stack || err); process.exit(1); });
}
