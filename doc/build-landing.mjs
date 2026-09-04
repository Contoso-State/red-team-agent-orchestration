import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const staticTopNavigation = `<script data-static-nav>
document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest(".myst-top-nav-item a") : null;
  if (!link || link.target === "_blank" || link.origin !== window.location.origin) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  window.location.assign(link.href);
}, { capture: true });
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

// The hosted asset layer serves each page as a static document. Force the top
// navigation to use document requests so MyST cannot retain stale route state
// if client-side hydration is interrupted.
const entries = await readdir(outputDirectory, { recursive: true, withFileTypes: true });
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
  const htmlPath = path.join(entry.parentPath ?? entry.path, entry.name);
  if (htmlPath === path.join(outputDirectory, "index.html")) continue;
  const html = await readFile(htmlPath, "utf8");
  if (!html.includes('class="myst-top-nav') || html.includes("data-static-nav")) continue;
  await writeFile(htmlPath, html.replace("</head>", `${staticTopNavigation}</head>`), "utf8");
}
