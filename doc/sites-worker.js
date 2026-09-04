async function fetchStaticAsset(request, env) {
  const url = new URL(request.url);
  const finalSegment = url.pathname.split("/").pop();
  const isDocumentRequest = ["GET", "HEAD"].includes(request.method) && !finalSegment?.includes(".");

  // Ask for the route's concrete document first. Some asset services answer a
  // clean URL with the root SPA shell instead of returning 404. That mismatches
  // MyST's route data during hydration and can leave the article pane blank.
  if (isDocumentRequest) {
    const documentUrl = new URL(url);
    documentUrl.pathname = `${url.pathname.replace(/\/$/, "")}/index.html`;
    const documentResponse = await env.ASSETS.fetch(new Request(documentUrl, request));
    if (documentResponse.status !== 404) return documentResponse;
  }

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
      return new Response("Static asset service unavailable", { status: 503 });
    }

    return fetchStaticAsset(request, env);
  },
};
