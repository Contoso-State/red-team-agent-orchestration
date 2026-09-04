import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const staticNavigation = `<script data-static-nav>
document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
  const target = new URL(link.href, window.location.href);
  if (target.origin !== window.location.origin || !/^https?:$/.test(target.protocol)) return;
  if (target.pathname === window.location.pathname && target.search === window.location.search && target.hash) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  window.location.assign(target.href);
}, { capture: true });
</script>`;

const constellationEmbed = `<div class="rt-constellation-shell">
  <iframe
    class="rt-constellation-frame"
    src="../agent-constellation.html"
    title="Interactive 3D map of the Azure Red Team agents and their continuous learning relationships"
    loading="eager"
  ></iframe>
</div>`;

const constellationRuntime = `<script data-agent-constellation>
(() => {
  const install = () => {
    for (const paragraph of document.querySelectorAll("p")) {
      if (paragraph.textContent.trim() !== "RT_AGENT_CONSTELLATION_EMBED") continue;
      const template = document.createElement("template");
      template.innerHTML = ${JSON.stringify(constellationEmbed)};
      paragraph.replaceWith(template.content);
    }
  };
  const observer = new MutationObserver(install);
  const start = () => window.setTimeout(() => {
    install();
    observer.observe(document.body, { childList: true, subtree: true });
  }, 250);
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
})();
</script>`;

const outputDirectory = path.resolve(process.argv[2] ?? "_build/html");
const source = await readFile(new URL("./index.md", import.meta.url), "utf8");
const shell = await readFile(new URL("./landing-shell.html", import.meta.url), "utf8");
const match = source.match(/:::\{raw\} text\n([\s\S]*?)\n:::\s*$/);

if (!match) {
  throw new Error("Could not find the landing-page raw text block in index.md");
}

const rendered = shell.replace("<!-- RT_LANDING_BODY -->", match[1]);
await writeFile(path.join(outputDirectory, "index.html"), rendered, "utf8");
await copyFile(new URL("./assets/custom.css", import.meta.url), path.join(outputDirectory, "landing.css"));
await copyFile(new URL("./assets/ninja-logo.svg", import.meta.url), path.join(outputDirectory, "ninja-logo.svg"));
await copyFile(new URL("./assets/social-card.png", import.meta.url), path.join(outputDirectory, "social-card.png"));
await copyFile(new URL("./assets/agent-constellation.html", import.meta.url), path.join(outputDirectory, "agent-constellation.html"));

// The hosted asset layer serves each page as a static document. Force the top
// navigation, sidebars, article links, and footer to use document requests so
// MyST cannot retain stale route state if client-side hydration is interrupted.
const entries = await readdir(outputDirectory, { recursive: true, withFileTypes: true });
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
  const htmlPath = path.join(entry.parentPath ?? entry.path, entry.name);
  if (htmlPath === path.join(outputDirectory, "index.html")) continue;
  const html = await readFile(htmlPath, "utf8");
  const hasConstellation = html.includes("RT_AGENT_CONSTELLATION_EMBED");
  let next = html;
  if (hasConstellation && !next.includes("data-agent-constellation")) {
    next = next.replace("</head>", `${constellationRuntime}</head>`);
  }
  if (next.includes('class="myst-top-nav') && !next.includes("data-static-nav")) {
    next = next.replace("</head>", `${staticNavigation}</head>`);
  }
  if (next !== html) await writeFile(htmlPath, next, "utf8");
}
