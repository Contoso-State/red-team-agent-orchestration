async function fetchStaticAsset(request, env) {
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404 || !["GET", "HEAD"].includes(request.method)) {
    return response;
  }

  const url = new URL(request.url);
  const finalSegment = url.pathname.split("/").pop();
  if (finalSegment?.includes(".")) return response;

  url.pathname = `${url.pathname.replace(/\/$/, "")}/index.html`;
  return env.ASSETS.fetch(new Request(url, request));
}

export default {
  async fetch(request, env) {
    if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
      return new Response("Static asset service unavailable", { status: 503 });
    }

    return fetchStaticAsset(request, env);
  },
};
