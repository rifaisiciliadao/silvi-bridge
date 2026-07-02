import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./config.mjs";
import {
  readSilviGis,
  readSilviMap,
  readSilviProject,
  readSilviProjectMap,
  readSilviProjectResource,
  readSilviProjects,
  readSilviRoot,
  toMapFeatureCollection
} from "./silvi-client.mjs";

const config = getConfig();
const mapDirectory = fileURLToPath(new URL("../../embed-map/", import.meta.url));
const mapContentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (request.method === "OPTIONS") {
    return sendEmpty(response, 204);
  }

  try {
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
      return sendRedirect(response, "/map/", request.method === "HEAD");
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/map") {
      return sendRedirect(response, `/map/${url.search}`, request.method === "HEAD");
    }

    if ((request.method === "GET" || request.method === "HEAD") && (url.pathname === "/map" || url.pathname.startsWith("/map/"))) {
      return sendMapAsset(url.pathname, response, request.method === "HEAD");
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return sendJson(response, 200, {
        ok: true,
        service: "silvi-bridge",
        upstreamBaseUrl: config.baseUrl,
        projectsPath: config.projectsPath
      });
    }

    if (url.pathname === "/api/silvi/root" && request.method === "GET") {
      return sendJson(response, 200, await readSilviRoot({ config, searchParams: url.searchParams }));
    }

    if (url.pathname === "/api/silvi/gis" && request.method === "GET") {
      return sendJson(response, 200, await readSilviGis({ config, searchParams: url.searchParams }));
    }

    if (url.pathname === "/api/silvi/projects" && request.method === "GET") {
      const payload = await readSilviProjects({ config, searchParams: url.searchParams });
      return sendJson(response, 200, payload);
    }

    if (url.pathname === "/api/silvi/projects.geojson" && request.method === "GET") {
      const payload = await readSilviProjects({ config, searchParams: url.searchParams });
      return sendJson(response, 200, payload.featureCollection);
    }

    if (url.pathname === "/api/silvi/map.geojson" && request.method === "GET") {
      const payload = await readSilviMap({ config, searchParams: url.searchParams });
      return sendJson(response, 200, payload.featureCollection);
    }

    const projectMapRoute = matchProjectMapRoute(url.pathname);
    if (projectMapRoute && request.method === "GET") {
      const payload = await readSilviProjectMap(projectMapRoute.projectId, { config, searchParams: url.searchParams });
      return sendJson(response, 200, payload.featureCollection);
    }

    const projectRoute = matchProjectRoute(url.pathname);
    if (projectRoute && request.method === "GET") {
      const { projectId, resource, wantsGeoJson } = projectRoute;

      if (!resource) {
        return sendJson(response, 200, await readSilviProject(projectId, { config, searchParams: url.searchParams }));
      }

      const payload = await readSilviProjectResource(projectId, resource, { config, searchParams: url.searchParams });
      if (wantsGeoJson && resource === "zones") {
        const project = await readSilviProject(projectId, { config });
        const zones = Array.isArray(payload) ? payload : payload.zones || payload.results || payload.items || [];
        return sendJson(response, 200, toMapFeatureCollection([project], [{ project, zones }]));
      }

      return sendJson(response, 200, payload);
    }

    if (url.pathname.startsWith("/api/silvi/")) {
      return sendJson(response, 404, {
        error: {
          code: "NOT_FOUND",
          message: "Unknown Silvi bridge endpoint"
        }
      });
    }

    return sendJson(response, 404, {
      error: {
        code: "NOT_FOUND",
        message: "Not found"
      }
    });
  } catch (error) {
    return sendJson(response, error.statusCode || 500, {
      error: {
        code: error.code || "INTERNAL_ERROR",
        message: error.message || "Internal error",
        details: error.details
      }
    });
  }
});

server.listen(config.port, () => {
  console.log(`silvi-bridge listening on http://localhost:${config.port}`);
});

async function sendMapAsset(pathname, response, headOnly = false) {
  const relativePath = pathname === "/map" || pathname === "/map/" ? "index.html" : pathname.replace(/^\/map\//, "");
  const safePath = normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const allowed = new Set([
    "apple-touch-icon.png",
    "favicon-32.png",
    "favicon.svg",
    "iframe.html",
    "icon-512.png",
    "index.html",
    "map.js",
    "og-image.png",
    "og-image.svg",
    "SilviMapFrame.tsx",
    "styles.css"
  ]);
  const filename = basename(safePath);

  if (!allowed.has(filename)) {
    return sendJson(response, 404, {
      error: {
        code: "NOT_FOUND",
        message: "Unknown Silvi map asset"
      }
    });
  }

  try {
    const asset = await readFile(join(mapDirectory, filename));
    applyHeaders(response, 200, mapContentTypes[extname(filename)] || "application/octet-stream");
    response.end(headOnly ? undefined : asset);
  } catch {
    return sendJson(response, 404, {
      error: {
        code: "NOT_FOUND",
        message: "Silvi map asset not found"
      }
    });
  }
}

function sendJson(response, statusCode, payload) {
  applyHeaders(response, statusCode, "application/json; charset=utf-8");
  response.end(JSON.stringify(payload, null, 2));
}

function sendEmpty(response, statusCode) {
  applyHeaders(response, statusCode);
  response.end();
}

function sendRedirect(response, location, headOnly = false) {
  applyHeaders(response, 308, "text/plain; charset=utf-8");
  response.setHeader("Location", location);
  response.end(headOnly ? undefined : `Redirecting to ${location}`);
}

function applyHeaders(response, statusCode, contentType) {
  response.statusCode = statusCode;
  response.setHeader("Access-Control-Allow-Origin", config.allowedOrigin);
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
  response.setHeader("Cache-Control", "no-store");

  if (contentType) {
    response.setHeader("Content-Type", contentType);
  }
}

function matchProjectMapRoute(pathname) {
  const match = pathname.match(/^\/api\/silvi\/projects\/([^/]+)\/map\.geojson\/?$/);
  return match ? { projectId: decodeURIComponent(match[1]) } : null;
}

function matchProjectRoute(pathname) {
  const match = pathname.match(/^\/api\/silvi\/projects\/([^/]+)(?:\/([^/.]+)(\.geojson)?|\/?)$/);
  if (!match) {
    return null;
  }

  return {
    projectId: decodeURIComponent(match[1]),
    resource: match[2] || null,
    wantsGeoJson: match[3] === ".geojson"
  };
}
