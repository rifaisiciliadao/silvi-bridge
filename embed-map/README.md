# Embed Map

Static Leaflet/OpenStreetMap client for Silvi project data exposed by the
backend.

It is served by the backend at `/map/` and requires no frontend build step.

## Views

All-project map:

```text
http://localhost:4317/map/
```

Single-project map:

```text
http://localhost:4317/map/?project=29
```

Full-viewport iframe host:

```text
http://localhost:4317/map/iframe.html?project=29
```

The iframe host forwards its query string to the inner `/map/` page, so
`iframe.html?project=29` opens the same single-project view.

## Query Parameters

- `project`: project ID. Loads only
  `/api/silvi/projects/:projectId/map.geojson`.
- `api`: explicit GeoJSON endpoint. Defaults to `/api/silvi/map.geojson` or the
  project-scoped endpoint when `project` is present.
- `tiles`: Leaflet tile URL template. Defaults to OpenStreetMap tiles.
- `tileAttribution`: attribution HTML for the selected tile provider.

## UI Behavior

The all-project view shows:

- project count;
- zone count;
- tree count;
- technical GeoJSON feature count;
- project filter/open-link actions.

The single-project view intentionally hides the project list and technical
project/zone/feature counters. It shows:

- a compact tree count;
- an icon-only `GeoJSON` link;
- a clear loading overlay while data is loading.

Tree points are clickable. Clicking a tree opens a side detail panel with
species, health, verification, linked claim fields, evidence photos, and compact
raw data behind an icon-only raw toggle. The detail header stays sticky while
the panel scrolls.

## Iframe Usage

```html
<iframe
  src="https://bridge.example.com/map/?project=29"
  title="Oasi Maker live project map"
  style="width: 100%; height: 640px; border: 0"
></iframe>
```

## React Wrapper

`SilviMapFrame.tsx` exports a small iframe component:

```tsx
import { SilviMapFrame } from "./SilviMapFrame";

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

Use `apiUrl` only when you need to override the GeoJSON endpoint:

```tsx
<SilviMapFrame
  src="https://bridge.example.com/map/"
  apiUrl="https://static.example.com/silvi-map.geojson"
/>
```
