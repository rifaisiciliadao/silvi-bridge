# Silvi Bridge

[![CI](https://github.com/rifaisiciliadao/silvi-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/rifaisiciliadao/silvi-bridge/actions/workflows/ci.yml)

Public reference implementation for rendering Rifai Sicilia DAO project data
from the Silvi Protocol public API.

The repository is intentionally split into two small, isolated parts:

- `backend/`: dependency-free Node.js API bridge. It keeps the Silvi API key on
  the server, reads Silvi project/zone/tree/STAC data, and returns normalized
  JSON and GeoJSON.
- `embed-map/`: static Leaflet/OpenStreetMap client served by the backend at
  `/map/` for the Rifai Sicilia domain. It can be opened directly, embedded as
  an iframe, or wrapped with the included React component.
- `growfi-map/`: duplicated static Leaflet/OpenStreetMap client served by the
  backend at `/map/` when the request host is `silvi.growfi.dev`.

This repository is public. Never commit real Silvi API keys, production tokens,
private RPC URLs, local `.env` files, raw customer exports, or any other secret.

## Capabilities

- Reads the Silvi staging public API with query-parameter authentication.
- Proxies project list, project detail, GIS, zones, trees, logs, images,
  seed-bed, potted-bed, and STAC resources.
- Builds map-ready GeoJSON for all projects at `/api/silvi/map.geojson`.
- Builds project-scoped GeoJSON at
  `/api/silvi/projects/:projectId/map.geojson`.
- Can refresh and serve map-ready JSON/GeoJSON from a DigitalOcean Spaces cache,
  so public map embeds do not wait on live Silvi/STAC aggregation.
- Redirects `/` to `/map/` so the public domain opens the visual map and social
  crawlers resolve the OpenGraph preview.
- Serves a standalone live map at `/map/`.
- Supports direct single-project map links such as `/map/?project=29`.
- Supports an iframe host at `/map/iframe.html`, including query-string
  propagation to the inner map.
- Serves the same bridge API at `https://silvi.rifaisicilia.com` and
  `https://silvi.growfi.dev`, with host-specific static map apps and social
  assets.
- Serves OpenGraph and favicon assets for social previews and browser tabs.
- Displays tree details, linked claim data, and compact image evidence linked
  from project photos. Full raw upstream payloads are only included when
  `SILVI_INCLUDE_RAW=true`.
- Uses OpenStreetMap tiles by default and supports custom Leaflet tile URLs.
- Ships smoke tests with a mock upstream, so tests do not require the real Silvi
  API key.

## Repository Layout

```text
.
├── backend/
│   ├── package.json
│   ├── src/
│   │   ├── cache-manager.mjs
│   │   ├── cache-store.mjs
│   │   ├── config.mjs
│   │   ├── server.mjs
│   │   └── silvi-client.mjs
│   └── scripts/
│       ├── smoke.mjs
│       └── http-smoke.mjs
├── embed-map/
│   ├── index.html
│   ├── iframe.html
│   ├── map.js
│   ├── styles.css
│   └── SilviMapFrame.tsx
└── growfi-map/
    ├── index.html
    ├── iframe.html
    ├── map.js
    ├── styles.css
    └── SilviMapFrame.tsx
```

## Requirements

- Node.js 22 LTS.
- A Silvi public API key for real upstream data.

No runtime npm dependencies are currently required.

## Quickstart

Create a local environment file:

```bash
cp backend/.env.example backend/.env.local
```

Edit `backend/.env.local` and set:

```bash
SILVI_API_KEY=replace_with_real_key
```

Start the backend:

```bash
set -a
. ./backend/.env.local
set +a
npm start
```

Open:

```text
http://localhost:4317/map/
```

Single-project map example:

```text
http://localhost:4317/map/?project=29
```

Production single-project map example:

```text
https://silvi.growfi.dev/map/?project=28
```

Iframe host example:

```text
http://localhost:4317/map/iframe.html?project=29
```

## Configuration

All configuration is read by `backend/src/config.mjs`.

| Variable | Default | Required | Purpose |
| --- | --- | --- | --- |
| `PORT` | `4317` | No | Local HTTP port. |
| `SILVI_API_KEY` | empty | Yes for real upstream | Silvi API key. Never expose this to browsers. |
| `SILVI_API_BASE_URL` | `https://admin.staging.silvi.earth/public-api` | No | Silvi public API root. |
| `SILVI_PROJECTS_PATH` | `/projects/` | No | Upstream project-list path. |
| `SILVI_AUTH_MODE` | `query` | No | `query` appends the key as a query string; `header` sends it as a header. |
| `SILVI_AUTH_QUERY_PARAM` | `key` | No | Query parameter used when `SILVI_AUTH_MODE=query`. |
| `SILVI_AUTH_HEADER` | `Authorization` | No | Header name used when `SILVI_AUTH_MODE=header`. |
| `SILVI_AUTH_SCHEME` | `Bearer` | No | Header prefix used when `SILVI_AUTH_MODE=header`. Set empty for raw key headers. |
| `SILVI_ALLOWED_ORIGIN` | `*` | No | CORS origin for embed clients. |
| `SILVI_REQUEST_TIMEOUT_MS` | `60000` | No | Upstream request timeout. |
| `SILVI_INCLUDE_RAW` | `false` | No | Includes full upstream payloads in some responses for debugging. Do not enable by default on public deployments. |
| `SILVI_CACHE_ENABLED` | `false` | No | Enables cache reads and scheduled cache refresh. |
| `SILVI_CACHE_BACKEND` | `spaces` | No | Cache store. Use `spaces` in production or `memory` for tests. |
| `SILVI_CACHE_REFRESH_ON_START` | `true` | No | Starts one refresh shortly after server boot. |
| `SILVI_CACHE_REFRESH_INTERVAL_MS` | `300000` | No | Refresh cadence for cached JSON/GeoJSON. |
| `SILVI_CACHE_PROJECT_CONCURRENCY` | `2` | No | Number of project maps refreshed in parallel. |
| `SILVI_CACHE_REQUEST_TIMEOUT_MS` | `60000` | No | Timeout for Spaces cache requests. |
| `SILVI_CACHE_SPACES_ENDPOINT` | `https://fra1.digitaloceanspaces.com` | Required for Spaces | DigitalOcean Spaces S3 endpoint. |
| `SILVI_CACHE_SPACES_REGION` | `fra1` | Required for Spaces | Spaces region used for request signing. |
| `SILVI_CACHE_SPACES_BUCKET` | empty | Required for Spaces | Bucket used for cached JSON/GeoJSON objects. |
| `SILVI_CACHE_SPACES_PREFIX` | `silvi-cache` | No | Object prefix inside the bucket. |
| `SILVI_CACHE_SPACES_ACCESS_KEY_ID` | empty | Required for Spaces | Spaces access key. Configure as a secret in production. |
| `SILVI_CACHE_SPACES_SECRET_ACCESS_KEY` | empty | Required for Spaces | Spaces secret key. Configure as a secret in production. |

Silvi staging currently expects API-key authentication as `?key=...`. The
backend appends this upstream and never writes the key into map URLs.

## Backend Endpoints

Health and entrypoint:

- `GET /` redirects to `/map/`
- `GET /health`
- `GET /api/silvi/cache/manifest`

Raw and normalized API proxy endpoints:

- `GET /api/silvi/root`
- `GET /api/silvi/gis`
- `GET /api/silvi/projects`
- `GET /api/silvi/projects/:projectId`
- `GET /api/silvi/projects/:projectId/gis`
- `GET /api/silvi/projects/:projectId/zones`
- `GET /api/silvi/projects/:projectId/trees`
- `GET /api/silvi/projects/:projectId/logs`
- `GET /api/silvi/projects/:projectId/images`
- `GET /api/silvi/projects/:projectId/seed-beds`
- `GET /api/silvi/projects/:projectId/potted-beds`
- `GET /api/silvi/projects/:projectId/stac`

GeoJSON endpoints:

- `GET /api/silvi/projects.geojson`
- `GET /api/silvi/map.geojson`
- `GET /api/silvi/projects/:projectId/map.geojson`
- `GET /api/silvi/projects/:projectId/zones.geojson`

Static map endpoints:

- `GET /map/`
- `GET /map/og-image.png`
- `GET /map/og-image.svg`
- `GET /map/favicon.svg`
- `GET /map/favicon-32.png`
- `GET /map/apple-touch-icon.png`
- `GET /map/icon-512.png`
- `GET /map/iframe.html`
- `GET /map/styles.css`
- `GET /map/map.js`

## GeoJSON Model

The map GeoJSON uses standard `FeatureCollection` responses with a `kind`
property:

- `kind: "project"`: project point. If Silvi does not provide direct project
  coordinates, the backend derives a point from zone geometry.
- `kind: "zone"`: project zone polygon or line geometry.
- `kind: "tree"`: tree point with species, health, verification, height,
  project metadata, linked claim fields when available, and optional
  `mediaAssets` for nearby project image evidence.

`features.length` is a technical GeoJSON count. It includes project, zone, and
tree geometries. The embedded map only exposes this technical count on the
all-project view; single-project views show the tree count only.

When project images include coordinates, tree features can include a compact
`properties.mediaAssets` array. Images are associated with the nearest tree
within 20 meters and are shown in the detail panel.

## Cache Model

When `SILVI_CACHE_ENABLED=true`, the server starts a refresh job on boot and then
repeats it every `SILVI_CACHE_REFRESH_INTERVAL_MS` milliseconds. The refresh
builds and writes these JSON objects:

- `projects.json`
- `projects.geojson`
- `map.geojson`
- `projects/:projectId.json`
- `projects/:projectId/map.geojson`
- `projects/:projectId/zones.geojson`
- `manifest.json`

Public map endpoints first read these objects from the configured cache backend.
If an object is missing, the endpoint falls back to the live Silvi API. Responses
include `X-Silvi-Cache: HIT`, `MISS`, or `BYPASS`.

## Map Usage

Full map:

```html
<iframe
  src="https://bridge.example.com/map/"
  title="Rifai Sicilia DAO live project map"
  style="width: 100%; height: 640px; border: 0"
></iframe>
```

Single-project map:

```html
<iframe
  src="https://silvi.growfi.dev/map/?project=28"
  title="Oasi Maker live project map"
  style="width: 100%; height: 640px; border: 0"
></iframe>
```

Full-viewport iframe host:

```text
https://bridge.example.com/map/iframe.html?project=29
```

Supported map query parameters:

| Parameter | Purpose |
| --- | --- |
| `project` | Project ID. When present, the map loads only `/api/silvi/projects/:projectId/map.geojson`. |
| `api` | Override GeoJSON URL. Useful for demos or static snapshots. |
| `tiles` | Leaflet tile URL template. Defaults to OpenStreetMap. |
| `tileAttribution` | Attribution HTML for the selected tile provider. |

The single-project view is intentionally minimal: it shows a compact tree
counter and a small GeoJSON icon link. It hides the large project banner,
project list, and technical project/zone/feature counters.

The detail panel uses icon-only raw/close controls. Its header stays sticky
while scrolling through claim, detail, photo, and raw-data sections.

## React Wrapper

`embed-map/SilviMapFrame.tsx` exports a small iframe wrapper:

```tsx
import { SilviMapFrame } from "./embed-map/SilviMapFrame";

export function ProjectMap() {
  return (
    <SilviMapFrame
      src="https://bridge.example.com/map/?project=29"
      title="Oasi Maker live project map"
      style={{ height: 640 }}
    />
  );
}
```

If `apiUrl` is provided, the component appends it as the `api` query parameter.

## Tests

Run all checks from the repository root:

```bash
npm test
```

Equivalent backend commands:

```bash
npm --prefix backend run check
npm --prefix backend run smoke
npm --prefix backend run http-smoke
```

The test suite uses mock HTTP servers and does not need the real Silvi API key.

## Status

This repository is a public integration PoC. It is designed to be easy to audit,
run locally, and embed in another application while the production deployment
shape is finalized.

## Deployment Notes

- Deploy `backend/` as the HTTP service.
- Serve requests from the repository root, or keep the relative layout where
  `backend/src/server.mjs` can read `../../embed-map/`.
- Configure `SILVI_API_KEY` as a secret in the hosting platform.
- Do not set `SILVI_INCLUDE_RAW=true` in public production deployments unless
  there is a specific debugging need.
- Restrict `SILVI_ALLOWED_ORIGIN` if the backend is exposed outside controlled
  environments.
- The map frontend is static and is served directly by the backend. No separate
  frontend build step is required.

## Security Rules For This Public Repository

- Commit only `.env.example`, never `.env` or `.env.local`.
- Do not paste real API keys into README files, tests, screenshots, issues, or
  commit messages.
- Do not commit raw Silvi payload dumps if they contain private or unpublished
  data.
- Keep browser-facing URLs free of API keys. The backend is the only component
  that talks to authenticated Silvi endpoints.

For vulnerability or secret-exposure reports, follow `SECURITY.md`.

## Troubleshooting

`SILVI_API_KEY is required`

: Load `backend/.env.local` before starting the server, or set the key in the
  deployment environment.

`Bridge returned HTTP 404`

: Check the project ID and the configured `SILVI_API_BASE_URL`.

The map opens but appears empty

: Open the GeoJSON link in the map panel and verify that the response contains
  renderable geometries.

Single-project link loads slowly

: Use `/map/?project=:projectId`. That path loads the project-scoped GeoJSON
  endpoint instead of the full all-project dataset.
