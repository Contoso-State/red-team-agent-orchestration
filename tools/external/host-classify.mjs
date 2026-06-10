#!/usr/bin/env node
/**
 * host-classify.mjs — pure, dependency-free host / IP classification.
 *
 * Shared by build-targets.mjs (allowlist generation) and the redteam-guardrails egress
 * matcher (scope enforcement). Kept free of any node:sqlite / datastore import so the
 * guardrail extension can use it without loading the database layer.
 *
 * Everything here is "public-only": a value classifies to a target ONLY if it is a
 * globally-routable internet host. RFC1918 / loopback / link-local / CGNAT IPs, Azure
 * Private Link (privatelink.*) and other internal FQDNs, wildcards, and bare filenames
 * all classify to null so they can never enter an allowlist or pass an egress check.
 */

// FQDN suffixes/markers that indicate a PRIVATE (not internet-facing) endpoint.
const PRIVATE_FQDN_MARKERS = [
  /(^|\.)privatelink\./i, // Azure Private Link private endpoints
  /\.internal($|\.)/i,
  /\.local$/i,
  /\.cluster\.local$/i,
  /\.svc($|\.)/i,
];

/** Parse a dotted IPv4 string into octets, or null if not a valid IPv4. */
export function parseIpv4(s) {
  const m = String(s).trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.some((n) => n > 255) ? null : o;
}

function looksLikeIp(s) {
  if (parseIpv4(s)) return true;
  return /:/.test(s) && /^[0-9a-f:]+(%[0-9a-z]+)?$/i.test(s);
}

/** True only for a globally-routable public IPv4 (excludes RFC1918/loopback/link-local/CGNAT/etc.). */
export function isPublicIpv4(s) {
  const o = parseIpv4(s);
  if (!o) return false;
  const [a, b, c] = o;
  if (a === 0 || a === 10 || a === 127) return false;            // this-net, RFC1918, loopback
  if (a === 169 && b === 254) return false;                       // link-local
  if (a === 172 && b >= 16 && b <= 31) return false;              // RFC1918
  if (a === 192 && b === 168) return false;                       // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return false;             // CGNAT 100.64/10
  if (a === 192 && b === 0 && c === 2) return false;              // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false;          // benchmarking
  if (a === 198 && b === 51 && c === 100) return false;           // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false;            // TEST-NET-3
  if (a >= 224) return false;                                     // multicast + reserved
  return true;
}

/** True only for a global-unicast (2000::/3) IPv6 address. */
export function isPublicIpv6(s) {
  if (typeof s !== 'string' || !/:/.test(s)) return false;
  const h = s.trim().toLowerCase().replace(/%[0-9a-z]+$/i, '');
  if (!/^[0-9a-f:]+$/i.test(h)) return false;
  if (h === '::' || h === '::1') return false;       // unspecified / loopback
  if (/^fe[89ab]/.test(h)) return false;             // link-local fe80::/10
  if (/^f[cd]/.test(h)) return false;                // unique-local fc00::/7
  if (/^ff/.test(h)) return false;                   // multicast
  const first = parseInt(h.split(':')[0] || '0', 16);
  return first >= 0x2000 && first <= 0x3fff;         // global unicast 2000::/3
}

/** True for a syntactically-valid PUBLIC FQDN (has a dot, no wildcard, not a private marker). */
export function isPublicFqdn(host) {
  if (typeof host !== 'string') return false;
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (!h || h.length > 253) return false;
  if (h.includes('*')) return false;
  if (looksLikeIp(h)) return false;
  if (!/^[a-z0-9]([a-z0-9-]{0,62})(\.[a-z0-9]([a-z0-9-]{0,62}))+$/.test(h)) return false;
  for (const re of PRIVATE_FQDN_MARKERS) if (re.test(h)) return false;
  return true;
}

/**
 * Classify a raw candidate string (URL, FQDN, or IP, optionally with scheme/port) into a
 * normalized public target, or null if it is not a public internet-facing host.
 * Returns { host, kind: 'fqdn'|'ip', url|null }.
 */
export function classifyCandidate(raw) {
  if (raw == null) return null;
  let value = String(raw).trim();
  if (!value) return null;
  let url = null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    let u;
    try { u = new URL(value); } catch { return null; }
    url = value;
    value = u.hostname;
  } else if (value.includes('/')) {
    // bare host with a path, e.g. example.com/admin
    value = value.split('/')[0];
  }

  value = value.replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '').toLowerCase();
  // Strip a :port suffix on IPv4 / FQDN forms (not on bracketless IPv6, which has many colons).
  if (/^[^:]+:\d{1,5}$/.test(value)) value = value.replace(/:\d{1,5}$/, '');
  if (!value) return null;

  if (isPublicIpv4(value) || isPublicIpv6(value)) return { host: value, kind: 'ip', url };
  if (isPublicFqdn(value)) return { host: value, kind: 'fqdn', url };
  return null;
}
