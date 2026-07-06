import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";

const mockProjects = [
  {
    id: 29,
    name: "Silvi HTTP Smoke",
    status: "active",
    bbox: [14, 37, 15, 38]
  }
];

const mockZones = [
  {
    id: "zone-http-smoke",
    name: "HTTP Smoke Zone",
    type: "forest",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [14, 37],
          [15, 37],
          [15, 38],
          [14, 38],
          [14, 37]
        ]
      ]
    }
  }
];

const mockStacTrees = [
  {
    type: "Feature",
    stac_version: "1.0.0",
    id: "tree-http-smoke",
    geometry: {
      type: "Point",
      coordinates: [14.25, 37.25]
    },
    properties: {
      id: "tree-http-smoke",
      model: "trees",
      title: "Holm oak tree",
      species_common_name: "Holm oak",
      species_scientific_name: "Quercus ilex",
      tree_health_display: "Healthy",
      tree_height: 120,
      tree_height_unit: "centimeters",
      verified: true,
      datetime: "2026-07-01T08:33:52.000Z"
    }
  }
];

const mockStacClaims = [
  {
    type: "Feature",
    stac_version: "1.0.0",
    id: "claim-http-smoke",
    geometry: {
      type: "Point",
      coordinates: [14.25, 37.25]
    },
    properties: {
      id: "claim-http-smoke",
      model: "logs",
      title: "Proof of Planting claim",
      claim_type_display: "Proof of Planting",
      claim_amount: "1.20000",
      claim_approved: true,
      timestamp: "2026-07-01T08:40:00.000Z",
      notes: "HTTP smoke claim",
      goal: "Mediterranean Coast",
      creator: "Rifai Sicilia DAO",
      tree: {
        id: "tree-http-smoke",
        title: "Holm oak tree"
      },
      datetime: "2026-07-01T08:40:00.000Z"
    }
  }
];

const upstream = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  response.setHeader("Content-Type", "application/json");

  if (url.pathname === "/core/stac/vector/trees/zones/1/items/") {
    assert.equal(request.headers.authorization, undefined);
    assert.equal(url.searchParams.get("key"), null);
    return response.end(JSON.stringify({
      type: "FeatureCollection",
      features: mockStacTrees,
      context: {
        page: 1,
        limit: 50,
        matched: mockStacTrees.length,
        returned: mockStacTrees.length
      }
    }));
  }

  if (url.pathname === "/core/stac/vector/logs/zones/1/items/") {
    assert.equal(request.headers.authorization, undefined);
    assert.equal(url.searchParams.get("key"), null);
    return response.end(JSON.stringify({
      type: "FeatureCollection",
      features: mockStacClaims,
      context: {
        page: 1,
        limit: 50,
        matched: mockStacClaims.length,
        returned: mockStacClaims.length
      }
    }));
  }

  assert.equal(request.headers.authorization, undefined);
  assert.equal(url.searchParams.get("key"), "http-test-key");

  if (url.pathname === "/") {
    return response.end(JSON.stringify({ scope: "organization", projects: mockProjects }));
  }

  if (url.pathname === "/projects/") {
    return response.end(JSON.stringify({ scope: "organization", projects: mockProjects }));
  }

  if (url.pathname === "/gis/") {
    return response.end(JSON.stringify({ scope: "organization", projects: mockProjects }));
  }

  if (url.pathname === "/projects/29/") {
    return response.end(JSON.stringify(mockProjects[0]));
  }

  if (url.pathname === "/projects/29/gis/") {
    return response.end(JSON.stringify({ zones: mockZones }));
  }

  if (url.pathname === "/projects/29/zones/") {
    return response.end(JSON.stringify({ zones: mockZones }));
  }

  if (url.pathname === "/projects/29/trees/") {
    return response.end(JSON.stringify({
      count: 0,
      page: 1,
      page_size: 1000,
      num_pages: 1,
      trees: []
    }));
  }

  if (url.pathname === "/projects/29/stac/") {
    const origin = `http://${request.headers.host}`;
    return response.end(JSON.stringify({
      stac_catalog: `${origin}/core/stac/catalog.json`,
      zones: [
        {
          id: "zone-http-smoke",
          name: "HTTP Smoke Zone",
          trees: `${origin}/core/stac/vector/trees/zones/1/items/`,
          logs: `${origin}/core/stac/vector/logs/zones/1/items/`
        }
      ]
    }));
  }

  response.statusCode = 404;
  response.end(JSON.stringify({ detail: "not found" }));
});

await new Promise((resolve) => upstream.listen(0, resolve));

const bridgePort = await getOpenPort();
const upstreamPort = upstream.address().port;
const child = spawn(process.execPath, ["src/server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(bridgePort),
    SILVI_API_KEY: "http-test-key",
    SILVI_API_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
    SILVI_PROJECTS_PATH: "/projects/",
    SILVI_AUTH_MODE: "query",
    SILVI_AUTH_QUERY_PARAM: "key"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForServer(bridgePort);

  const health = await readJson(`http://127.0.0.1:${bridgePort}/health`);
  assert.equal(health.ok, true);

  const rootRedirect = await readResponse(`http://127.0.0.1:${bridgePort}/`, { redirect: "manual" });
  assert.equal(rootRedirect.status, 308);
  assert.equal(rootRedirect.headers.get("location"), "/map/");

  const projects = await readJson(`http://127.0.0.1:${bridgePort}/api/silvi/projects`);
  assert.equal(projects.count, 1);
  assert.equal(projects.mappedCount, 1);

  const root = await readJson(`http://127.0.0.1:${bridgePort}/api/silvi/root`);
  assert.equal(root.scope, "organization");

  const gis = await readJson(`http://127.0.0.1:${bridgePort}/api/silvi/gis`);
  assert.equal(gis.scope, "organization");

  const projectGis = await readJson(`http://127.0.0.1:${bridgePort}/api/silvi/projects/29/gis`);
  assert.equal(projectGis.zones.length, 1);

  const zones = await readJson(`http://127.0.0.1:${bridgePort}/api/silvi/projects/29/zones`);
  assert.equal(zones.zones.length, 1);

  const trees = await readJson(`http://127.0.0.1:${bridgePort}/api/silvi/projects/29/trees`);
  assert.equal(trees.trees.length, 0);

  const geojson = await readJson(`http://127.0.0.1:${bridgePort}/api/silvi/projects.geojson`);
  assert.equal(geojson.type, "FeatureCollection");
  assert.equal(geojson.features.length, 1);

  const mapGeojson = await readJson(`http://127.0.0.1:${bridgePort}/api/silvi/map.geojson`);
  assert.equal(mapGeojson.type, "FeatureCollection");
  assert.equal(mapGeojson.features.length, 3);
  assert.equal(mapGeojson.features[0].geometry.type, "Polygon");
  assert.equal(mapGeojson.features.find((feature) => feature.properties.kind === "tree").properties.species, "Holm oak");
  assert.equal(mapGeojson.features.find((feature) => feature.properties.kind === "tree").properties.scientificName, "Quercus ilex");
  assert.equal(mapGeojson.features.find((feature) => feature.properties.kind === "tree").properties.source, "stac");
  assert.equal(mapGeojson.features.find((feature) => feature.properties.kind === "tree").properties.claimType, "Proof of Planting");
  assert.equal(mapGeojson.features.find((feature) => feature.properties.kind === "tree").properties.claimAmount, "1.20000");
  assert.notDeepEqual(
    mapGeojson.features.find((feature) => feature.properties.kind === "project").geometry.coordinates,
    [0, 0]
  );

  const projectMapGeojson = await readJson(`http://127.0.0.1:${bridgePort}/api/silvi/projects/29/map.geojson`);
  assert.equal(projectMapGeojson.type, "FeatureCollection");
  assert.equal(projectMapGeojson.features.length, 3);
  assert.equal(projectMapGeojson.features.find((feature) => feature.properties.kind === "tree").properties.projectId, 29);

  const zonesGeojson = await readJson(`http://127.0.0.1:${bridgePort}/api/silvi/projects/29/zones.geojson`);
  assert.equal(zonesGeojson.features[0].properties.projectId, 29);

  const mapHtml = await readText(`http://127.0.0.1:${bridgePort}/map/`);
  assert.match(mapHtml, /Rifai Sicilia DAO \| Live Silvi Project Map/);
  assert.match(mapHtml, /Explore verified Silvi Protocol project geography/);
  assert.match(mapHtml, /property="og:image" content="https:\/\/silvi\.rifaisicilia\.com\/map\/og-image\.png"/);
  assert.match(mapHtml, /name="twitter:card" content="summary_large_image"/);
  assert.match(mapHtml, /href="\/map\/favicon\.svg" type="image\/svg\+xml"/);

  const growfiHost = "silvi.growfi.dev";
  const growfiMapHtml = (await readWithHost({ port: bridgePort, path: "/map/", host: growfiHost })).text;
  assert.match(growfiMapHtml, /GrowFi \| Silvi Protocol Project Map/);
  assert.match(growfiMapHtml, /Explore Silvi Protocol geography, tree records, planting claims, and field evidence linked to a GrowFi campaign/);
  assert.match(growfiMapHtml, /property="og:image" content="https:\/\/silvi\.growfi\.dev\/map\/og-image\.png"/);
  assert.doesNotMatch(growfiMapHtml, /Rifai Sicilia DAO/);

  const mapRedirect = await readResponse(`http://127.0.0.1:${bridgePort}/map?project=29`, { redirect: "manual" });
  assert.equal(mapRedirect.status, 308);
  assert.equal(mapRedirect.headers.get("location"), "/map/?project=29");

  const ogImage = await readResponse(`http://127.0.0.1:${bridgePort}/map/og-image.png`);
  assert.equal(ogImage.ok, true);
  assert.match(ogImage.headers.get("content-type"), /image\/png/);

  const growfiOgImage = await readWithHost({ port: bridgePort, path: "/map/og-image.png", host: growfiHost });
  assert.equal(growfiOgImage.statusCode, 200);
  assert.match(growfiOgImage.headers["content-type"], /image\/png/);

  const favicon = await readResponse(`http://127.0.0.1:${bridgePort}/map/favicon.svg`);
  assert.equal(favicon.ok, true);
  assert.match(favicon.headers.get("content-type"), /image\/svg\+xml/);

  const growfiFavicon = (await readWithHost({ port: bridgePort, path: "/map/favicon.svg", host: growfiHost })).text;
  assert.match(growfiFavicon, /GrowFi Silvi Protocol/);
  assert.doesNotMatch(growfiFavicon, /Rifai Sicilia DAO/);

  const faviconPng = await readResponse(`http://127.0.0.1:${bridgePort}/map/favicon-32.png`);
  assert.equal(faviconPng.ok, true);
  assert.match(faviconPng.headers.get("content-type"), /image\/png/);

  const iframeHtml = await readText(`http://127.0.0.1:${bridgePort}/map/iframe.html`);
  assert.match(iframeHtml, /id="silvi-map-frame"/);
  assert.match(iframeHtml, /Rifai Sicilia DAO \| Silvi Map Embed/);
  assert.match(iframeHtml, /property="og:image" content="https:\/\/silvi\.rifaisicilia\.com\/map\/og-image\.png"/);
  assert.match(iframeHtml, /window\.location\.search/);
  assert.match(iframeHtml, /width: 100vw/);
  assert.match(iframeHtml, /height: 100vh/);

  const growfiIframeHtml = (await readWithHost({ port: bridgePort, path: "/map/iframe.html", host: growfiHost })).text;
  assert.match(growfiIframeHtml, /GrowFi \| Silvi Protocol Map Embed/);
  assert.match(growfiIframeHtml, /property="og:image" content="https:\/\/silvi\.growfi\.dev\/map\/og-image\.png"/);
  assert.doesNotMatch(growfiIframeHtml, /Rifai Sicilia DAO/);

  console.log("silvi-bridge http smoke ok");
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => upstream.close(resolve));
}

async function getOpenPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForServer(port) {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      await delay(100);
    }
  }

  throw new Error("Bridge server did not start");
}

async function readJson(url, init) {
  const response = await fetch(url, init);
  assert.equal(response.ok, true);
  return response.json();
}

async function readText(url, init) {
  const response = await fetch(url, init);
  assert.equal(response.ok, true);
  return response.text();
}

async function readResponse(url, init) {
  return fetch(url, init);
}

async function readWithHost({ port, path, host }) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path,
      method: "GET",
      headers: { host }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks);
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body,
          text: body.toString("utf8")
        });
      });
    });

    request.on("error", reject);
    request.end();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
