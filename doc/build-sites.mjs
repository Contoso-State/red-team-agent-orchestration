import { spawnSync } from "node:child_process";
import { copyFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const documentationDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(documentationDirectory, "..");
const outputDirectory = path.join(documentationDirectory, "_build", "html");
const environment = { ...process.env };

// A literal BASE_URL=/ makes MyST emit protocol-relative URLs such as
// //build/app.js. Browsers then look for a host named "build". Root-hosted
// deployments must leave BASE_URL unset.
delete environment.BASE_URL;

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: documentationDirectory,
    env: environment,
    stdio: "inherit",
    ...options,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npx", ["--yes", "mystmd@1.10.1", "build", "--html", "--ci"]);

await copyFile(
  path.join(repositoryDirectory, "tools", "report", "sample", "report.sample.html"),
  path.join(outputDirectory, "report.sample.html"),
);

run(process.execPath, [path.join(documentationDirectory, "build-landing.mjs"), outputDirectory]);

const entries = await readdir(outputDirectory, { recursive: true, withFileTypes: true });
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
  const htmlPath = path.join(entry.parentPath ?? entry.path, entry.name);
  const html = await readFile(htmlPath, "utf8");
  if (/\b(?:href|src)=["']\/\/(?:build\/|favicon\.ico|myst-theme\.css|["'])/.test(html)) {
    throw new Error(`Root-hosting build contains a protocol-relative internal URL: ${htmlPath}`);
  }
}

console.log(`Root-hosted static site built at ${outputDirectory}`);
