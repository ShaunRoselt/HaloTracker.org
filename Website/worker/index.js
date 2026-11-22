const serveAsset = (request, env, pathname) => {
  const url = new URL(request.url);
  url.pathname = pathname;
  return env.ASSETS.fetch(new Request(url, request));
};

const isDocumentRequest = (pathname) => (
  pathname === "/"
  || pathname === "/index.html"
  || !pathname.split("/").at(-1).includes(".")
);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname || "/";
    const response = await serveAsset(request, env, pathname === "/" ? "/index.html" : pathname);

    if (response.status === 404 && isDocumentRequest(pathname)) {
      return serveAsset(request, env, "/index.html");
    }

    return response;
  },
};
