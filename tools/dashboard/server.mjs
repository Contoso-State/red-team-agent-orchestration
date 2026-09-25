#!/usr/bin/env node
/** Loopback-only, read-only projection of an explicitly selected session event log. */
import { createServer } from 'node:http';
import { openSync, closeSync, readSync, fstatSync, lstatSync, readFileSync, existsSync, constants } from 'node:fs';
import { resolve, relative, sep, dirname, basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeModelUsage } from '../graph/model-usage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MAX_LINE = 64 * 1024;
const MAX_EVENTS = 2000;
const TYPES = new Set(['run.started', 'run.completed', 'run.failed', 'node.started', 'node.completed', 'node.failed', 'agent.started', 'agent.completed', 'agent.failed', 'tool.allowed', 'tool.cached', 'tool.completed', 'tool.failed', 'message.sent', 'task.dispatched', 'memory.retrieved', 'memory.verified', 'memory.candidate', 'memory.promoted', 'memory.measured', 'evaluation.completed', 'model.usage', 'evolution.proposed', 'evolution.evaluated', 'evolution.accepted', 'evolution.rejected']);
const STATUSES = new Set(['running', 'started', 'completed', 'failed', 'blocked', 'pending', 'allowed', 'skipped', 'idle', 'candidate', 'promoted', 'retrieved', 'measured']);
const METRICS = new Set(['duration_ms', 'count', 'findings', 'confirmed_findings', 'candidates', 'promoted', 'retrieved', 'measured', 'quality', 'revision', 'tools', 'resources', 'checks', 'passed', 'failed', 'baseline', 'observed', 'delta', 'latency_ms', 'experience_count', 'knowledge_count', 'suppression_count', 'records', 'evidenceFiles', 'cache_hits', 'azure_reads', 'context_tokens', 'context_budget', 'challenge_total', 'holdout_total']);
const ASSETS = new Map([['/model-usage-summary.mjs', ['model-usage-summary.mjs', 'text/javascript; charset=utf-8']],['/node-resolver.mjs', ['node-resolver.mjs', 'text/javascript; charset=utf-8']],['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]]);

function identifier(value, max = 100) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value !== 'string' || value.length > max || !/^[a-zA-Z0-9][a-zA-Z0-9 _.:&()/-]*$/.test(value)) return undefined;
  if (/bearer|secret|password|token|credential|connectionstring/i.test(value)) return undefined;
  return value;
}

export function safeReference(value) {
  if (typeof value !== 'string' || value.length > 220 || !/^[a-zA-Z0-9][a-zA-Z0-9_. /-]*$/.test(value)) return null;
  if (value.split('/').some(part => part === '..' || part === '.' || part.startsWith('.'))) return null;
  if (!/^(?:evidence|findings|reports|coverage|inventory|runs|memory)\//.test(value)) return null;
  if (/secret|token|password|credential|connectionstring|\.azure/i.test(value)) return null;
  return value;
}

/** Free-form summaries, message bodies, commands, outputs and reasoning are never forwarded. */
export function projectEvent(raw) {
  if (!raw || raw.schema_version !== 1 || !TYPES.has(raw.type)) return null;
  const id = identifier(raw.id), ts = typeof raw.ts === 'string' && /^\d{4}-\d\d-\d\dT/.test(raw.ts) && Number.isFinite(Date.parse(raw.ts)) ? new Date(raw.ts).toISOString() : null;
  if (!id || !ts) return null;
  const event = { schema_version: 1, id, ts, type: raw.type };
  for (const key of ['session_id', 'run_id', 'agent_id', 'node_id', 'from_agent', 'to_agent', 'task_id', 'exchange_id']) {
    const value = identifier(raw[key]);
    if (value !== undefined) event[key] = value;
  }
  if (STATUSES.has(raw.status)) event.status = raw.status;
  if (['live', 'dry-run', 'replay'].includes(raw.mode)) event.mode = raw.mode;
  if (['assessment', 'memory-review', 'code-evolution'].includes(raw.run_kind)) event.run_kind = raw.run_kind;
  event.summary = raw.type.replaceAll('.', ' · ').replaceAll('_', ' ');
  event.evidence_refs = Array.isArray(raw.evidence_refs) ? raw.evidence_refs.slice(0, 20).map(safeReference).filter(Boolean) : [];
  event.metrics = {};
  for (const [key, value] of Object.entries(raw.metrics || {})) if (METRICS.has(key) && typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12) event.metrics[key] = value;
  if (raw.type === 'message.sent' && ['model-request', 'model-response', 'memory-request', 'memory-response', 'code-candidate', 'findings-data', 'evidence-data'].includes(raw.transfer?.kind)) {
    const { kind, bytes, outcome } = raw.transfer;
    if (Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= 1e12 && ['sent', 'received', 'failed'].includes(outcome)) event.transfer = { kind, bytes, outcome };
  }
  if (raw.type === 'evaluation.completed' && raw.evaluation?.kind === 'model-judgment') {
    event.evaluation = { kind: 'model-judgment', comparison: 'not-controlled' };
    if (['refine', 'proceed'].includes(raw.evaluation.route)) event.evaluation.route = raw.evaluation.route;
  }
  if (raw.type === 'model.usage') event.usage = normalizeModelUsage(raw.usage);
  if (raw.type.startsWith('memory.')) {
    event.memory = { stage: raw.type.split('.')[1] };
    if (Array.isArray(raw.memory?.source_ids)) event.memory.source_ids = [...new Set(raw.memory.source_ids.slice(0, 50).map(x => identifier(x)).filter(Boolean))];
    if (/^[a-f0-9]{64}$/.test(raw.memory?.environment_key || '')) event.memory.environment_key = raw.memory.environment_key;
    if (['inert', 'evidence-integrity-verified'].includes(raw.memory?.outcome)) event.memory.outcome = raw.memory.outcome;
  }
  return event;
}

function contained(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !resolve(rel).startsWith(`${sep}${sep}`) && !rel.startsWith(sep));
}

/** Reject symlinks in each component, including the session itself. */
function assertSafePath(root, target, allowMissing = true) {
  if (!contained(root, target)) throw new Error('Path is outside the engagement root');
  const components = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const component of ['', ...components]) {
    if (component) current = join(current, component);
    try { if (lstatSync(current).isSymbolicLink()) throw new Error('Symbolic links are not served'); }
    catch (error) { if (error.code === 'ENOENT' && allowMissing) return; throw error; }
  }
}

export function createDashboard({ session, engagementRoot = join(ROOT, 'engagements'), graphPath = join(ROOT, 'graph/redteam.graph.json'), pollMs = 300 } = {}) {
  if (!session) throw new Error('Select a session with --session engagements/<session>');
  const allowedRoot = resolve(engagementRoot), sessionDir = resolve(session), eventPath = join(sessionDir, 'runs/live-events.jsonl');
  assertSafePath(allowedRoot, sessionDir, false);
  if (!lstatSync(sessionDir).isDirectory() || sessionDir === allowedRoot) throw new Error('Select one engagement directory');
  const rawGraph = JSON.parse(readFileSync(graphPath, 'utf8'));
  const topology = {
    nodes: rawGraph.nodes.map(({ id, kind, agent }) => ({ id, kind, ...(agent && !agent.startsWith('$') ? { agent } : {}) })),
    edges: rawGraph.edges.map(({ from, to }) => ({ from, to })),
    roster: rawGraph.roster.map(({ domain, agent }) => ({ domain, agent })),
  };
  let events = [], offset = 0, partial = '', fileIdentity = '', dropped = 0, generation = 0, oversized = false, logState = 'waiting', closed = false;
  const clients = new Set();
  const send = (client, name, data) => {
    if (client.writableLength > 1024 * 1024) { client.destroy(); clients.delete(client); return; }
    client.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const snapshot = () => ({ session_id: basename(sessionDir), events, generation, dropped, log_state: logState, retained_limit: MAX_EVENTS, source: 'append-only session metadata', server_time: new Date().toISOString(), topology });
  /** Reports live at a fixed path inside the selected session; no request input reaches the filesystem. */
  // Download name: "<subscription>-<report date>.pdf". A single fixed filename
  // made every download collide in the browser's Downloads folder, so an older
  // copy kept being opened instead of the fresh one. Values are sanitised to a
  // conservative charset because they land in a response header.
  const safeName = v => String(v || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const reportFilename = (ext = 'pdf') => {
    let sub = '';
    try {
      const doc = readFileSync(join(sessionDir, 'engagement.yaml'), 'utf8');
      // first `name:` nested under the subscriptions list
      const block = doc.split(/^\s*subscriptions\s*:/m)[1] || '';
      sub = safeName((block.match(/^\s*name\s*:\s*(.+)$/m) || [])[1]?.replace(/["']/g, '').trim());
    } catch { /* fall through to the generic name */ }
    let date = '';
    try { date = new Date(lstatSync(join(sessionDir, `reports/report.${ext}`)).mtime).toISOString().slice(0, 10); } catch { /* ignore */ }
    const parts = [sub || 'azure-assessment-report', date].filter(Boolean);
    return `${parts.join('-')}.${ext}`;
  };
  const reportFile = name => {
    const target = join(sessionDir, 'reports', name);
    try { assertSafePath(allowedRoot, target, false); return readFileSync(target); } catch { return null; }
  };
  function scan() {
    if (closed) return;
    let fd;
    try {
      assertSafePath(allowedRoot, eventPath);
      if (!existsSync(eventPath)) { logState = 'waiting'; return; }
      fd = openSync(eventPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const stat = fstatSync(fd);
      if (!stat.isFile()) throw new Error('Event log must be a regular file');
      const identity = `${stat.dev}:${stat.ino}`;
      if (fileIdentity && (identity !== fileIdentity || stat.size < offset)) {
        events = []; offset = 0; partial = ''; generation++; oversized = false;
        for (const client of clients) send(client, 'reset', { generation });
      }
      fileIdentity = identity;
      if (stat.size === offset) { logState = 'ready'; return; }
      const chunk = Buffer.alloc(Math.min(stat.size - offset, 1024 * 1024));
      const bytes = readSync(fd, chunk, 0, chunk.length, offset); offset += bytes;
      const lines = (partial + chunk.subarray(0, bytes).toString('utf8')).split('\n');
      partial = lines.pop();
      for (const line of lines) {
        if (oversized) { oversized = false; dropped++; continue; }
        if (!line.trim()) continue;
        if (Buffer.byteLength(line) > MAX_LINE) { dropped++; continue; }
        let event;
        try { event = projectEvent(JSON.parse(line)); } catch { dropped++; continue; }
        if (!event) { dropped++; continue; }
        // Source offsets provide unique transport cursors even when run-local IDs repeat.
        event.cursor = `${generation}:${offset}:${events.length}:${event.run_id || ''}:${event.id}`;
        events.push(event);
        if (events.length > MAX_EVENTS) events.shift();
        for (const client of clients) send(client, 'activity', event);
      }
      if (Buffer.byteLength(partial) > MAX_LINE) { partial = ''; oversized = true; }
      logState = 'ready';
    } catch { logState = 'unavailable'; }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  scan();
  const timer = setInterval(scan, Math.max(50, pollMs)); timer.unref();
  const heartbeat = setInterval(() => { for (const client of clients) send(client, 'health', { log_state: logState, dropped, server_time: new Date().toISOString() }); }, 5000); heartbeat.unref();
  const server = createServer((req, res) => {
    const host = req.headers.host || '';
    const ownOrigin = `http://${host}`;
    if (!/^127\.0\.0\.1:\d+$/.test(host) || (req.headers.origin && req.headers.origin !== ownOrigin) || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403); res.end('Local same-origin access only'); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    const path = req.url?.split('?')[0];
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", 'Cross-Origin-Resource-Policy': 'same-origin' };
    const json = (code, body) => { res.writeHead(code, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(req.method === 'HEAD' ? '' : JSON.stringify(body)); };
    if (path === '/api/snapshot') { scan(); json(200, snapshot()); return; }
    if (path === '/api/events') {
      res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      if (req.method === 'HEAD') { res.end(); return; }
      send(res, 'snapshot', snapshot()); clients.add(res);
      req.on('close', () => clients.delete(res)); return;
    }
    if (path === '/api/evidence') {
      const query = new URL(req.url, ownOrigin).searchParams;
      const event = events.find(e => e.cursor === query.get('event'));
      const ref = event?.evidence_refs[Number(query.get('index'))];
      if (!event || !query.has('index') || !/^\d+$/.test(query.get('index')) || !ref) { json(404, { error: 'Recorded reference not found' }); return; }
      json(200, { reference: ref, event_id: event.id, timestamp: event.ts, agent: event.agent_id || event.node_id || 'orchestrator', disclosure: 'Recorded reference only. Artifact contents and existence are not exposed by this server.' }); return;
    }
    if (path === '/api/findings') {
      const body = reportFile('findings.json');
      if (!body) { json(200, { findings: [] }); return; }
      res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(req.method === 'HEAD' ? '' : body); return;
    }
    if (path === '/api/report') {
      const body = reportFile('report.html');
      if (!body) { json(404, { error: 'Report not found' }); return; }
      // ?download=1 saves the file; otherwise the report opens in the tab.
      if (new URL(req.url, ownOrigin).searchParams.get('download') === '1') {
        res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${reportFilename('html')}"` });
        res.end(req.method === 'HEAD' ? '' : body); return;
      }
      // The report is a self-contained document: its styling and interactivity
      // are inline, so the dashboard's own strict style-src/script-src would
      // render it unstyled. Give this response a document-scoped policy that
      // permits only its own inline assets while allowing NO network access at
      // all (default-src 'none', no connect-src) — tighter than opening the
      // same file from disk, so model-authored finding text cannot phone home.
      const reportCsp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
      const bar = Buffer.from(`<style>
.rt-dlbar{position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;gap:8px;font:500 13px/1 ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif}
.rt-dlbar a{display:inline-flex;align-items:center;gap:7px;padding:10px 14px;border-radius:8px;text-decoration:none;box-shadow:0 2px 10px #0003}
.rt-dlbar .rt-pdf{background:#14303a;color:#67e6dd;border:1px solid #67e6dd66}
.rt-dlbar .rt-html{background:#1d2836;color:#c3d2e2;border:1px solid #3b4a5c}
@media print{.rt-dlbar{display:none}}
</style><div class="rt-dlbar no-print"><a class="rt-pdf" href="/api/report.pdf">&#8595; Download PDF</a><a class="rt-html" href="/api/report?download=1">&#8595; Download HTML</a></div>`, 'utf8');
      const marker = Buffer.from('</body>', 'utf8');
      const at = body.lastIndexOf(marker);
      const page = at === -1 ? Buffer.concat([body, bar]) : Buffer.concat([body.subarray(0, at), bar, body.subarray(at)]);
      res.writeHead(200, { ...headers, 'Content-Security-Policy': reportCsp, 'Content-Type': 'text/html; charset=utf-8' });
      res.end(req.method === 'HEAD' ? '' : page); return;
    }
    if (path === '/api/report.pdf') {
      const body = reportFile('report.pdf');
      if (!body) { json(404, { error: 'Report not found' }); return; }
      res.writeHead(200, { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${reportFilename()}"` }); res.end(req.method === 'HEAD' ? '' : body); return;
    }
    if (path === '/ninja-logo.svg') {
      res.writeHead(200, { ...headers, 'Content-Type': 'image/svg+xml' });
      res.end(req.method === 'HEAD' ? '' : readFileSync(join(ROOT, 'assets/ninja-logo.svg'))); return;
    }
    if (ASSETS.has(path)) {
      const [name, type] = ASSETS.get(path);
      res.writeHead(200, { ...headers, 'Content-Type': type }); res.end(req.method === 'HEAD' ? '' : readFileSync(join(HERE, 'public', name))); return;
    }
    json(404, { error: 'Not found' });
  });
  return {
    server, scan, snapshot,
    async listen(port = 4318) { await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); }); return `http://127.0.0.1:${server.address().port}`; },
    async close() { closed = true; clearInterval(timer); clearInterval(heartbeat); for (const client of clients) client.end(); await new Promise(resolve => server.close(resolve)); },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log('Usage: node tools/dashboard/server.mjs --session engagements/<session> [--port 4318]\nRead-only local event dashboard. Binds 127.0.0.1 only.'); process.exit(0); }
  try {
    const options = {};
    for (let i = 0; i < args.length; i += 2) { if (!['--session', '--port'].includes(args[i]) || !args[i + 1]) throw new Error('Unknown or missing argument'); options[args[i].slice(2)] = args[i + 1]; }
    const port = options.port === undefined ? 4318 : Number(options.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
    const dashboard = createDashboard({ session: options.session });
    const url = await dashboard.listen(port);
    console.log(`Agent Observatory: ${url}\nSession: ${basename(resolve(options.session))}\nSource: runs/live-events.jsonl · metadata only · no Azure calls`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await dashboard.close(); process.exit(0); });
  } catch (error) { console.error(`Dashboard: ${error.message}`); process.exitCode = 1; }
}
