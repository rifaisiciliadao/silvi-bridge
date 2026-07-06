# Backend

Dependency-free Node.js API bridge for the Silvi public API.

The backend keeps the Silvi API key server-side, forwards approved requests to
Silvi, normalizes project data, and serves the static map assets from
`../embed-map` at `/map/` by default. Requests with `Host: silvi.growfi.dev`
serve the duplicated `../growfi-map` static app at the same `/map/` paths.

## Run Locally

From the repository root:

```bash
cp backend/.env.example backend/.env.local
```

Set `SILVI_API_KEY` in `backend/.env.local`, then start:

```bash
set -a
. ./backend/.env.local
set +a
npm start
```

Default server:

```text
http://localhost:4317
```

## Main Endpoints

- `GET /` redirects to `/map/`
- `GET /health`
- `GET /map/`
- `GET /map/og-image.png`
- `GET /map/og-image.svg`
- `GET /map/favicon.svg`
- `GET /map/favicon-32.png`
- `GET /map/apple-touch-icon.png`
- `GET /map/icon-512.png`
- `GET /map/iframe.html`
- `GET /api/silvi/root`
- `GET /api/silvi/gis`
- `GET /api/silvi/projects`
- `GET /api/silvi/projects.geojson`
- `GET /api/silvi/map.geojson`
- `GET /api/silvi/projects/:projectId`
- `GET /api/silvi/projects/:projectId/map.geojson`
- `GET /api/silvi/projects/:projectId/gis`
- `GET /api/silvi/projects/:projectId/zones`
- `GET /api/silvi/projects/:projectId/zones.geojson`
- `GET /api/silvi/projects/:projectId/trees`
- `GET /api/silvi/projects/:projectId/logs`
- `GET /api/silvi/projects/:projectId/images`
- `GET /api/silvi/projects/:projectId/seed-beds`
- `GET /api/silvi/projects/:projectId/potted-beds`
- `GET /api/silvi/projects/:projectId/stac`

## Authentication

Silvi staging currently expects API keys as a query parameter. The backend
appends `?key=$SILVI_API_KEY` upstream and never exposes the key to the
browser-facing map.

Client query params are forwarded upstream except params prefixed with `_`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4317` | Local HTTP port. |
| `SILVI_API_KEY` | required | API key provided by Silvi. |
| `SILVI_API_BASE_URL` | `https://admin.staging.silvi.earth/public-api` | Silvi public API root. |
| `SILVI_PROJECTS_PATH` | `/projects/` | Upstream project-list endpoint path. |
| `SILVI_AUTH_MODE` | `query` | Set to `header` only for alternate Silvi environments. |
| `SILVI_AUTH_QUERY_PARAM` | `key` | Query-string parameter used when `SILVI_AUTH_MODE=query`. |
| `SILVI_AUTH_HEADER` | `Authorization` | Auth header name used only when `SILVI_AUTH_MODE=header`. |
| `SILVI_AUTH_SCHEME` | `Bearer` | Prefix before the key for header auth. |
| `SILVI_ALLOWED_ORIGIN` | `*` | CORS origin for embed clients. |
| `SILVI_REQUEST_TIMEOUT_MS` | `60000` | Upstream timeout. |
| `SILVI_INCLUDE_RAW` | `false` | Include full upstream payloads for debugging. Keep disabled on public deployments. |

## GeoJSON

`/api/silvi/map.geojson` returns all renderable projects, zones, and trees.

`/api/silvi/projects/:projectId/map.geojson` returns only one project. The map
uses this endpoint automatically when opened with `/map/?project=:projectId`.

Tree features are merged from:

- the paginated `/projects/:projectId/trees/` endpoint;
- public STAC tree item links returned by `/projects/:projectId/stac/`;
- public STAC log item links, when they reference the same tree id.

When logs match a tree, the backend attaches compact claim fields and evidence
photo assets to the tree feature for the map detail panel.

## Checks

```bash
npm run check
npm run smoke
npm run http-smoke
npm test
```

The smoke tests use local mock upstream servers and do not require a real API
key.
