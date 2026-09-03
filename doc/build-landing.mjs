import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
await copyFile(new URL("./assets/social-card.png", import.meta.url), path.join(outputDirectory, "social-card.png"));
