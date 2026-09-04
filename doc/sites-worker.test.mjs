import assert from "node:assert/strict";
import test from "node:test";

import worker from "./sites-worker.js";

function assetEnvironment(routes) {
  const requests = [];
  return {
    requests,
    env: {
      ASSETS: {
        async fetch(request) {
          const pathname = new URL(request.url).pathname;
          requests.push(pathname);
          return routes.get(pathname) ?? new Response("missing", { status: 404 });
        },
      },
    },
  };
}

test("clean documentation routes resolve their index document before the SPA shell", async () => {
  const routes = new Map([
    ["/graph-engineering/index.html", new Response("graph")],
    ["/graph-engineering", new Response("wrong root shell")],
  ]);
  const { env, requests } = assetEnvironment(routes);

  const response = await worker.fetch(new Request("https://example.test/graph-engineering"), env);

  assert.equal(await response.text(), "graph");
  assert.deepEqual(requests, ["/graph-engineering/index.html"]);
});

test("root and trailing-slash routes resolve index documents", async () => {
  const routes = new Map([
    ["/index.html", new Response("home")],
    ["/skills/index.html", new Response("skills")],
  ]);
  const { env, requests } = assetEnvironment(routes);

  assert.equal(await (await worker.fetch(new Request("https://example.test/"), env)).text(), "home");
  assert.equal(await (await worker.fetch(new Request("https://example.test/skills/"), env)).text(), "skills");
  assert.deepEqual(requests, ["/index.html", "/skills/index.html"]);
});

test("files and missing documents fall back to the original asset request", async () => {
  const routes = new Map([
    ["/assets/custom.css", new Response("css")],
    ["/missing", new Response("fallback")],
  ]);
  const { env, requests } = assetEnvironment(routes);

  assert.equal(await (await worker.fetch(new Request("https://example.test/assets/custom.css"), env)).text(), "css");
  assert.equal(await (await worker.fetch(new Request("https://example.test/missing"), env)).text(), "fallback");
  assert.deepEqual(requests, ["/assets/custom.css", "/missing/index.html", "/missing"]);
});
