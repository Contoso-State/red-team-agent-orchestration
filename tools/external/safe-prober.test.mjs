#!/usr/bin/env node
/**
 * safe-prober.test.mjs — unit tests for the Tier-1 EVA safe prober analyzers + scope gate.
 *
 * Run: node tools/external/safe-prober.test.mjs
 *
 * Tests the PURE analyzers (no network) and that runProber refuses to run without a valid,
 * authorized engagement + allowlist. The actual HTTP/TLS probing is not exercised here.
 */

import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizeHeaders,
  analyzeSecurityHeaders,
  analyzeServerDisclosure,
  analyzeCookies,
  analyzeCors,
  analyzeMethods,
  analyzeTls,
  analyzeHttpRedirect,
  runProber,
  SECURITY_HEADERS,
} from './safe-prober.mjs';

let passed = 0;
function ok(c, m) { assert.ok(c, m); passed++; }
function eq(a, b, m) { assert.deepStrictEqual(a, b, m); passed++; }

// normalizeHeaders
eq(normalizeHeaders({ 'Content-Type': 'text/html' }), { 'content-type': 'text/html' }, 'lowercases keys');
eq(normalizeHeaders(null), {}, 'null -> {}');

// analyzeSecurityHeaders
{
  const findings = analyzeSecurityHeaders({});
  eq(findings.length, SECURITY_HEADERS.length, 'all security headers missing -> one finding each');
  ok(findings.every((f) => f.check === 'CHK-EVA-001'), 'all CHK-EVA-001');
}
{
  const full = {
    'strict-transport-security': 'max-age=63072000',
    'content-security-policy': "default-src 'self'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'geolocation=()',
  };
  eq(analyzeSecurityHeaders(full), [], 'fully-hardened response -> no findings');
}
{
  const f = analyzeSecurityHeaders({ 'strict-transport-security': '' });
  ok(f.some((x) => /HSTS/.test(x.title)), 'empty HSTS value still flagged');
}

// analyzeServerDisclosure
{
  const f = analyzeServerDisclosure({ server: 'nginx/1.18.0', 'x-powered-by': 'PHP/8.1.2' });
  eq(f.length, 2, 'two disclosure headers -> two findings');
  ok(f.every((x) => x.check === 'CHK-EVA-002'), 'CHK-EVA-002');
  ok(f.every((x) => x.severity === 'low'), 'versioned disclosure is low severity');
}
{
  const f = analyzeServerDisclosure({ server: 'Kestrel' });
  eq(f[0].severity, 'info', 'bare product name is info severity');
}
eq(analyzeServerDisclosure({}), [], 'no disclosure headers -> none');

// analyzeCookies
{
  const f = analyzeCookies(['sid=abc; Path=/']);
  ok(f.length === 1, 'insecure cookie flagged');
  ok(/Secure/.test(f[0].title) && /HttpOnly/.test(f[0].title) && /SameSite/.test(f[0].title), 'all three flags reported missing');
  eq(f[0].severity, 'medium', 'missing Secure/HttpOnly -> medium');
}
{
  const f = analyzeCookies(['sid=abc; Secure; HttpOnly; SameSite=Strict']);
  eq(f, [], 'fully-flagged cookie -> no findings');
}
{
  const f = analyzeCookies(['t=1; Secure; HttpOnly']);
  eq(f.length, 1, 'missing only SameSite still flagged');
  eq(f[0].severity, 'low', 'missing only SameSite -> low');
}

// analyzeCors
eq(analyzeCors({}, 'https://x.invalid'), [], 'no ACAO -> none');
{
  const f = analyzeCors({ 'access-control-allow-origin': '*' }, 'https://x.invalid');
  eq(f[0].severity, 'low', 'ACAO:* without creds -> low');
}
{
  const f = analyzeCors(
    { 'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true' },
    'https://x.invalid'
  );
  eq(f[0].severity, 'high', 'ACAO:* with creds -> high');
}
{
  const origin = 'https://eva-cors-probe.invalid';
  const f = analyzeCors(
    { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
    origin
  );
  eq(f[0].severity, 'high', 'reflected origin with creds -> high');
  ok(/reflects/.test(f[0].title), 'reflected-origin finding');
}

// analyzeMethods
eq(analyzeMethods('GET, HEAD, OPTIONS'), [], 'only safe methods -> none');
{
  const f = analyzeMethods('GET, PUT, DELETE, OPTIONS');
  eq(f.length, 1, 'risky methods -> one finding');
  ok(/PUT/.test(f[0].title) && /DELETE/.test(f[0].title), 'lists risky methods');
  eq(f[0].severity, 'medium', 'PUT/DELETE -> medium');
}
{
  const f = analyzeMethods('GET, TRACE');
  eq(f[0].severity, 'low', 'TRACE only -> low');
}

// analyzeTls
eq(analyzeTls({ protocol: 'TLSv1.3', daysToExpiry: 200 }), [], 'modern TLS, healthy cert -> none');
{
  const f = analyzeTls({ protocol: 'TLSv1', daysToExpiry: 200 });
  ok(f.some((x) => /Weak TLS/.test(x.title)), 'TLSv1 flagged weak');
}
{
  const f = analyzeTls({ protocol: 'TLSv1.2', daysToExpiry: -3 });
  ok(f.some((x) => /expired/.test(x.title) && x.severity === 'high'), 'expired cert -> high');
}
{
  const f = analyzeTls({ protocol: 'TLSv1.2', daysToExpiry: 5 });
  ok(f.some((x) => /expiring soon/.test(x.title) && x.severity === 'medium'), 'near-expiry -> medium');
}

// analyzeHttpRedirect
eq(analyzeHttpRedirect({ httpStatus: 301, redirectsToHttps: true }), [], 'HTTP redirects to HTTPS -> none');
{
  const f = analyzeHttpRedirect({ httpStatus: 200, redirectsToHttps: false });
  eq(f.length, 1, 'plaintext HTTP reachable -> finding');
  eq(f[0].check, 'CHK-EVA-007', 'CHK-EVA-007');
}

// runProber refuses without authorization (no network)
{
  const root = mkdtempSync(join(tmpdir(), 'eva-prober-'));
  // read-only engagement -> gate closed -> refuse
  writeFileSync(join(root, 'engagement.yaml'), 'mode: read-only-assessment\n');
  const r = await runProber(root);
  eq(r.ok, false, 'runProber refuses in read-only mode');
  eq(r.findings, [], 'no findings when refused');
  rmSync(root, { recursive: true, force: true });
}
{
  const root = mkdtempSync(join(tmpdir(), 'eva-prober2-'));
  // authorized mode but NO allowlist -> still refuse
  writeFileSync(
    join(root, 'engagement.yaml'),
    'mode: external-active-testing\nexternal_testing:\n  enabled: true\n  authorization:\n    attested_by: "X"\n    attestation_id: "Y"\n'
  );
  const r = await runProber(root);
  eq(r.ok, false, 'runProber refuses without an allowlist');
  rmSync(root, { recursive: true, force: true });
}

console.log(`OK \u2014 ${passed} safe-prober assertions passed`);
