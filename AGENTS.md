# AGENTS.md

## Project Scope

This repository is the public Rifai Sicilia DAO Silvi integration proof of
concept. It is intentionally separate from GrowFi.

Top-level structure:

- `backend/`: dependency-free Node.js ESM HTTP bridge for Silvi public API data.
- `embed-map/`: static Leaflet/OpenStreetMap embed client served by the backend
  at `/map/`.

Do not move this code back into the GrowFi repository unless explicitly
requested.

## Public Repository Rules

- Never commit real Silvi API keys, `.env`, `.env.local`, private RPC URLs,
  customer exports, raw private payload dumps, or local OS files.
- `backend/.env.example` is the only committed env template.
- Browser-facing URLs must never contain the Silvi API key. The backend appends
  the key only when calling upstream Silvi endpoints.
- Keep docs and code comments in English.

## Backend Architecture

Backend entrypoint:

- `backend/src/server.mjs`

Silvi client and normalization:

- `backend/src/silvi-client.mjs`

Configuration:

- `backend/src/config.mjs`

The backend reads `SILVI_API_KEY` from env. Silvi staging currently uses
query-parameter auth, so the bridge appends `?key=$SILVI_API_KEY` upstream.

The backend serves static map assets from:

- `../embed-map`

This relative layout matters. `backend/src/server.mjs` resolves the map folder
with `../../embed-map/`.

## Public Endpoints

Health and discovery:

- `GET /`
- `GET /health`

Silvi proxy endpoints:

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

Static embed endpoints:

- `GET /map/`
- `GET /map/iframe.html`
- `GET /map/styles.css`
- `GET /map/map.js`

## GeoJSON Schema

All map endpoints return standard GeoJSON `FeatureCollection` payloads.

Feature `properties.kind` values:

- `project`: project point.
- `zone`: project zone geometry.
- `tree`: tree point with species, health, verification, height, project
  metadata, linked claim fields, compact raw tree/claim payload, and photo
  assets when available.

`features.length` is a technical renderable geometry count, not a tree count.
The single-project UI hides this count and shows only the tree counter.

## Embed Map Behavior

All-project view:

- `/map/`
- Loads `/api/silvi/map.geojson`.
- Shows project, zone, tree, and technical feature counters.
- Shows project rows with filter and open-link actions.

Single-project view:

- `/map/?project=:projectId`
- Loads `/api/silvi/projects/:projectId/map.geojson`.
- Shows project name and tree count only.
- Hides project list and project/zone/feature counters.
- Does not show an `All maps` button.
- Shows a centered loading overlay while data is loading.

Iframe host:

- `/map/iframe.html`
- Forwards its query string to the inner `/map/` page, so
  `/map/iframe.html?project=29` opens `/map/?project=29` inside the iframe.

## Test Commands

Run from repository root:

```bash
npm test
```

Equivalent backend commands:

```bash
npm --prefix backend run check
npm --prefix backend run smoke
npm --prefix backend run http-smoke
```

The tests use local mock upstream servers and do not need the real Silvi API
key.

## Before Pushing

- Run `npm test`.
- Confirm `git status --short --ignored` does not include `.env`, `.env.local`,
  `.DS_Store`, or generated artifacts in staged files.
- Run a staged grep for real-looking Silvi keys before public pushes:

```bash
git grep --cached -n -E 'silvi_[A-Za-z0-9_]{20,}|SILVI_API_KEY=silvi_' -- ':!AGENTS.md'
```

No output is expected.
