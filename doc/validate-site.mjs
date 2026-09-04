#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SKIP_SCHEMES = /^(?:data:|mailto:|tel:|https?:|blob:)/i;

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function stripBase(reference, baseUrl) {
  if (!reference.startsWith("/")) return reference;
  const base = String(baseUrl || "").replace(/^\/+|\/+$/g, "");
  if (!base) return reference.slice(1);
  const prefix = `/${base}`;
  if (reference === prefix || reference === `${prefix}/`) return "";
  if (reference.startsWith(`${prefix}/`)) return reference.slice(prefix.length + 1);
  return reference.slice(1);
}

export async function validateStaticSite(outputDirectory, { baseUrl = process.env.BASE_URL } = {}) {
  const root = path.resolve(outputDirectory);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const htmlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
  const errors = [];
  let referencesChecked = 0;

  if (!(await isFile(path.join(root, "agent-constellation.html")))) {
    errors.push("agent-constellation.html: missing interactive graph asset");
  }

  for (const htmlFile of htmlFiles) {
    const html = await readFile(htmlFile, "utf8");
    const relativeHtml = path.relative(root, htmlFile);
    if (html.includes('class="myst-top-nav') && !html.includes("data-static-nav")) {
      errors.push(`${relativeHtml}: missing site-wide static-navigation guard`);
    }
    if (html.includes('class="myst-top-nav')) {
      const article = html.match(/<article\b[^>]*class=["'][^"']*\barticle\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);
      const readableText = article?.[1]
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z0-9#]+;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!article || !/<h1\b/i.test(article[1]) || readableText.length < 180) {
        errors.push(`${relativeHtml}: documentation route has no meaningful article content`);
      }
    }
    if (relativeHtml === path.join("agent-team", "index.html")) {
      if (!html.includes("../agent-constellation.html")) {
        errors.push(`${relativeHtml}: missing interactive agent constellation embed`);
      }
      if (html.includes("&lt;iframe") || !html.includes("data-agent-constellation")) {
        errors.push(`${relativeHtml}: agent constellation hydration guard is missing or escaped`);
      }
    }
    const references = [...html.matchAll(/\b(?:href|src|poster)=["']([^"']+)["']/gi)].map((match) => match[1]);

    for (const rawReference of references) {
      if (!rawReference || rawReference.startsWith("#") || SKIP_SCHEMES.test(rawReference)) continue;
      if (rawReference.startsWith("//")) {
        errors.push(`${relativeHtml}: protocol-relative URL ${rawReference}`);
        continue;
      }

      let clean;
      try {
        clean = decodeURIComponent(rawReference.split(/[?#]/, 1)[0]);
      } catch {
        errors.push(`${relativeHtml}: malformed URL encoding ${rawReference}`);
        continue;
      }
      if (!clean) continue;

      const relativeTarget = stripBase(clean, baseUrl);
      const resolved = clean.startsWith("/")
        ? path.resolve(root, relativeTarget)
        : path.resolve(path.dirname(htmlFile), relativeTarget);
      if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        errors.push(`${relativeHtml}: path escapes build root ${rawReference}`);
        continue;
      }

      const candidates = [resolved];
      if (!path.extname(resolved)) {
        candidates.push(`${resolved}.html`, path.join(resolved, "index.html"));
      }
      referencesChecked += 1;
      if (!(await Promise.all(candidates.map(isFile))).some(Boolean)) {
        errors.push(`${relativeHtml}: missing local target ${rawReference}`);
      }
    }
  }

  if (errors.length) {
    throw new Error(`Static-site integrity failed (${errors.length} error[s]):\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }
  return { htmlFiles: htmlFiles.length, referencesChecked };
}

async function main() {
  const outputDirectory = path.resolve(process.argv[2] ?? new URL("./_build/html", import.meta.url).pathname);
  const result = await validateStaticSite(outputDirectory);
  console.log(`✓ static site valid — ${result.htmlFiles} HTML files, ${result.referencesChecked} local references`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`✖ ${error.message}`);
    process.exitCode = 1;
  });
}
