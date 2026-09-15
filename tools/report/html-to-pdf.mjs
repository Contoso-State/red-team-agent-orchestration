#!/usr/bin/env node
/**
 * html-to-pdf.mjs — high-fidelity HTML -> PDF via headless Chrome print-to-PDF.
 *
 * The report's layout relies on modern CSS (flex/grid) plus an `@media print`
 * stylesheet. LibreOffice (`soffice --convert-to pdf`) understands neither and
 * fuses labels into values ("Engagement IDdemo-2026-09-15"), so we drive a real
 * browser engine instead. Chrome is launched headless and driven over the
 * DevTools Protocol (no npm dependencies), which lets us set A4 paper,
 * `printBackground` (without it the dark cover and severity chips vanish) and
 * shut the browser down cleanly afterwards.
 *
 * Usage:
 *   node tools/report/html-to-pdf.mjs --in <input.html> --out <output.pdf>
 *
 * Options:
 *   --in <path>      source HTML file                            (required)
 *   --out <path>     destination PDF file                        (required)
 *   --chrome <path>  override the Chrome/Chromium binary
 *   --settle <ms>    wait after load for inline SVG/canvas work   (default 2500)
 *   --margin <in>    page margin in inches                        (default 0)
 *   --paper <name>   a4 | letter                                  (default a4)
 */

import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const PAPER = {
  a4: { width: 8.27, height: 11.69 },
  letter: { width: 8.5, height: 11 },
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = value;
      i += 1;
    }
  }
  return out;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function isExecutable(p) {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findChrome(override) {
  if (override) {
    if (await isExecutable(override)) return override;
    throw new Error(`Chrome binary not executable: ${override}`);
  }
  for (const candidate of CHROME_CANDIDATES) {
    if (await isExecutable(candidate)) return candidate;
  }
  throw new Error('No Chrome/Chromium binary found. Pass --chrome <path>.');
}

/** Chrome writes the chosen debug port to DevToolsActivePort once it is up. */
async function waitForDevToolsPort(profileDir, timeoutMs = 30000) {
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const [port] = (await readFile(portFile, 'utf8')).split('\n');
      if (port && Number(port) > 0) return Number(port);
    } catch {
      /* not written yet */
    }
    await delay(100);
  }
  throw new Error('Timed out waiting for Chrome DevTools port.');
}

/** Minimal CDP client over the browser-level WebSocket endpoint. */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Cdp(ws)));
      ws.addEventListener('error', () => reject(new Error(`CDP connect failed: ${url}`)));
    });
  }

  send(method, params = {}, sessionId) {
    const id = (this.id += 1);
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

export async function htmlToPdf({
  input,
  output,
  chromePath,
  settleMs = 2500,
  marginInches = 0,
  relaxBreaks = false,
  paper = 'a4',
}) {
  const inAbs = path.resolve(input);
  const outAbs = path.resolve(output);
  await stat(inAbs); // clear ENOENT if the source is missing
  await mkdir(path.dirname(outAbs), { recursive: true });

  const size = PAPER[String(paper).toLowerCase()];
  if (!size) throw new Error(`Unknown paper size: ${paper} (use a4 or letter)`);

  const chrome = await findChrome(chromePath);
  const profile = path.join(tmpdir(), `html-to-pdf-${process.pid}-${Date.now()}`);
  await mkdir(profile, { recursive: true });

  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let chromeStderr = '';
  child.stderr.on('data', (d) => {
    chromeStderr += d;
  });

  let cdp;
  try {
    const port = await waitForDevToolsPort(profile);
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    cdp = await Cdp.connect(version.webSocketDebuggerUrl);

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Emulation.setEmulatedMedia', { media: 'print' }, sessionId);

    await cdp.send('Page.navigate', { url: pathToFileURL(inAbs).href }, sessionId);

    // Wait for the load event, then give inline SVG / canvas work time to settle.
    const loadDeadline = Date.now() + 30000;
    while (Date.now() < loadDeadline) {
      if (cdp.events.some((e) => e.method === 'Page.loadEventFired')) break;
      await delay(100);
    }
    await delay(settleMs);
    // Ensure fonts are laid out before we snapshot the pages.
    await cdp.send(
      'Runtime.evaluate',
      { expression: 'document.fonts ? document.fonts.ready.then(() => 1) : 1', awaitPromise: true },
      sessionId,
    );

    // Optional --flow: relax page-break rules AT RENDER TIME ONLY.
    // The report's own stylesheet marks whole sections and findings
    // break-inside:avoid; blocks taller than a page then get shunted to a fresh
    // page, leaving the previous one mostly blank. Injecting this here fixes
    // pagination for the printed copy without modifying the report generator
    // or the canonical report HTML, which must stay byte-stable.
    if (relaxBreaks) {
      await cdp.send(
        'Runtime.evaluate',
        {
          expression: `(() => {
            const s = document.createElement('style');
            s.textContent = '@media print{'
              + '.section{break-inside:auto !important;page-break-inside:auto !important}'
              + '.section>h2,.sec-intro{break-after:avoid;page-break-after:avoid}'
              + '.finding{break-inside:auto !important}'
              + '.finding-head{break-inside:avoid;break-after:avoid;page-break-after:avoid}'
              + '.finding-detail>*{break-inside:avoid}'
              + '}';
            document.head.appendChild(s);
            return 1;
          })()`,
        },
        sessionId,
      );
      await delay(150);
    }

    const { data } = await cdp.send(
      'Page.printToPDF',
      {
        printBackground: true, // without this the dark cover + severity colours vanish
        preferCSSPageSize: true,
        paperWidth: size.width,
        paperHeight: size.height,
        marginTop: marginInches,
        marginBottom: marginInches,
        marginLeft: marginInches,
        marginRight: marginInches,
        displayHeaderFooter: false,
        transferMode: 'ReturnAsBase64',
      },
      sessionId,
    );

    const buf = Buffer.from(data, 'base64');
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new Error('Chrome returned data that is not a PDF.');
    }
    await writeFile(outAbs, buf);

    await cdp.send('Browser.close').catch(() => {});
    cdp.close();
    return { chrome, output: outAbs, bytes: buf.length, paper, pages: undefined };
  } catch (err) {
    cdp?.close();
    throw new Error(`${err.message}\n${chromeStderr.trim().slice(0, 1500)}`);
  } finally {
    // Never leave a headless Chrome behind, even if printToPDF threw.
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    await delay(300);
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    await rm(profile, { recursive: true, force: true });
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.in !== 'string' || typeof args.out !== 'string') {
    console.error('usage: node tools/report/html-to-pdf.mjs --in <html> --out <pdf>');
    process.exit(2);
  }
  try {
    const res = await htmlToPdf({
      input: args.in,
      output: args.out,
      chromePath: typeof args.chrome === 'string' ? args.chrome : undefined,
      settleMs: args.settle ? Number(args.settle) : 2500,
      marginInches: args.margin ? Number(args.margin) : 0,
      relaxBreaks: Boolean(args.flow),
      paper: typeof args.paper === 'string' ? args.paper : 'a4',
    });
    console.log(`wrote ${res.output} (${res.bytes} bytes, ${res.paper}) via ${res.chrome}`);
    process.exit(0);
  } catch (err) {
    console.error(`html-to-pdf failed: ${err.message}`);
    process.exit(1);
  }
}
