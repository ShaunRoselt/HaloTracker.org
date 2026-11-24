import { lookupPlayerAchievements } from "./player-achievements.js";
import { getAchievementsForGame, guidePageTitle, hasGuide } from "./game-catalog.js";

const titleForGuide = ({ searchParams }) => {
  if (searchParams.get("page")?.trim().toLowerCase() !== "achievements") return null;
  const id = searchParams.get("achievement");
  if (!id) return null;
  const game = searchParams.get("game")?.trim().toLowerCase() || "halomcc";
  const guide = getAchievementsForGame(game).find((achievement) => achievement.id === id);
  return guide && hasGuide(guide) ? guidePageTitle(guide) : null;
};

const serveGuideDocument = async (request, env, title) => {
  const requestHeaders = new Headers(request.headers);
  for (const name of ["If-None-Match", "If-Modified-Since", "Range", "If-Range"]) requestHeaders.delete(name);
  const response = await serveAsset(new Request(request, { headers: requestHeaders }), env, "/index.html");
  if (response.status !== 200) return response;

  const headers = new Headers(response.headers);
  for (const name of ["Content-Length", "Content-Encoding", "ETag", "Last-Modified", "Accept-Ranges"]) headers.delete(name);
  if (request.method === "HEAD") return new Response(null, { headers });

  const escapedTitle = title.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const html = (await response.text()).replace(/<title>[^<]*<\/title>/, () => `<title>${escapedTitle}</title>`);
  return new Response(html, { headers });
};

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
    if (pathname === "/api/player-achievements") {
      return lookupPlayerAchievements(request, env);
    }
    if ((pathname === "/" || pathname === "/index.html") && ["GET", "HEAD"].includes(request.method)) {
      const title = titleForGuide(url);
      if (title) return serveGuideDocument(request, env, title);
    }
    const response = await serveAsset(request, env, pathname === "/" ? "/index.html" : pathname);

    if (response.status === 404 && isDocumentRequest(pathname)) {
      return serveAsset(request, env, "/index.html");
    }

    return response;
  },
};
