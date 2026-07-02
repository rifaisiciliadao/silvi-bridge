const DEFAULT_CENTER = [37.5079, 14.0825];
const DEFAULT_ZOOM = 7;
const DEFAULT_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const MIN_LOADER_VISIBLE_MS = 520;

const params = new URLSearchParams(window.location.search);
const initialProjectId = params.get("project") ? String(params.get("project")) : null;
const explicitApiUrl = params.get("api");
const apiUrl = explicitApiUrl || defaultApiUrl(initialProjectId);
const tileUrl = params.get("tiles") || DEFAULT_TILE_URL;
const tileAttribution = params.get("tileAttribution") || DEFAULT_TILE_ATTRIBUTION;
const FILTER_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
  </svg>
`;
const OPEN_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M14 3h7v7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M10 14 21 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`;

const elements = {
  apiLink: document.getElementById("apiLink"),
  claimList: document.getElementById("claimList"),
  claimSection: document.getElementById("claimSection"),
  detailCloseButton: document.getElementById("detailCloseButton"),
  detailFacts: document.getElementById("detailFacts"),
  detailFactsTitle: document.getElementById("detailFactsTitle"),
  detailKind: document.getElementById("detailKind"),
  detailPanel: document.getElementById("detailPanel"),
  detailRaw: document.getElementById("detailRaw"),
  detailRawButton: document.getElementById("detailRawButton"),
  mediaGrid: document.getElementById("mediaGrid"),
  mediaSection: document.getElementById("mediaSection"),
  rawSection: document.getElementById("rawSection"),
  detailSubtitle: document.getElementById("detailSubtitle"),
  detailTitle: document.getElementById("detailTitle"),
  featureCount: document.getElementById("featureCount"),
  fitButton: document.getElementById("fitButton"),
  mapLoader: document.getElementById("mapLoader"),
  mapLoaderText: document.getElementById("mapLoaderText"),
  mapShell: document.querySelector(".map-shell"),
  projectCount: document.getElementById("projectCount"),
  projectList: document.getElementById("projectList"),
  sourceBadge: document.getElementById("sourceBadge"),
  statusText: document.getElementById("statusText"),
  treeCount: document.getElementById("treeCount"),
  zoneCount: document.getElementById("zoneCount")
};

let map;
let allFeaturesLayer;
let projectLayers = new Map();
let fullFeatureCollection;
let activeProjectId = initialProjectId;
let loaderShownAt = 0;
let loaderHideTimeout;

bootstrap().catch((error) => {
  console.error(error);
  showLoader("Unable to load map data.", true);
  setStatus(error.message || "Unable to load Silvi map.", true);
});

async function bootstrap() {
  if (!window.L) {
    throw new Error("Leaflet did not load.");
  }

  elements.apiLink.href = apiUrl;
  elements.sourceBadge.textContent = sourceLabel(apiUrl);
  elements.mapShell.classList.toggle("is-project-view", Boolean(activeProjectId));
  showLoader(activeProjectId ? "Loading selected project map..." : "Loading live project map...");
  setStatus(activeProjectId ? "Loading selected project..." : "Loading Silvi project geography...");

  map = L.map("map", {
    attributionControl: false,
    preferCanvas: true,
    zoomControl: false
  }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.control.attribution({ prefix: false, position: "bottomleft" }).addAttribution(tileAttribution).addTo(map);
  L.tileLayer(tileUrl, {
    maxZoom: 20,
    crossOrigin: true,
    attribution: tileAttribution
  }).addTo(map);

  const featureCollection = await loadFeatureCollection();
  renderFeatureCollection(featureCollection);
}

async function loadFeatureCollection() {
  const response = await fetch(apiUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Bridge returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
    throw new Error("Bridge did not return GeoJSON.");
  }

  return {
    ...payload,
    features: payload.features.filter(hasRenderableGeometry)
  };
}

function renderFeatureCollection(featureCollection) {
  fullFeatureCollection = featureCollection;
  renderCurrentView({ fit: true });

  elements.fitButton.addEventListener("click", () => {
    fitVisibleMap();
  });
  elements.detailCloseButton.addEventListener("click", closeDetailPanel);
  elements.detailRawButton.addEventListener("click", toggleRawDetails);
  hideLoader();
}

function renderCurrentView({ fit = false } = {}) {
  const allFeatures = fullFeatureCollection.features;
  const allZones = allFeatures.filter((feature) => feature.properties?.kind === "zone");
  const allTrees = allFeatures.filter((feature) => feature.properties?.kind === "tree");
  const projects = allFeatures.filter((feature) => feature.properties?.kind === "project");
  const activeProject = activeProjectId
    ? projects.find((project) => String(project.properties?.id) === activeProjectId)
    : null;

  if (activeProjectId && !activeProject) {
    activeProjectId = null;
    syncProjectUrl();
  }

  const visibleFeatures = activeProjectId ? allFeatures.filter(matchesActiveProject) : allFeatures;
  const visibleZones = visibleFeatures.filter((feature) => feature.properties?.kind === "zone");
  const visibleTrees = visibleFeatures.filter((feature) => feature.properties?.kind === "tree");
  const visibleProjects = visibleFeatures.filter((feature) => feature.properties?.kind === "project");

  if (allFeaturesLayer) {
    allFeaturesLayer.remove();
  }

  const isProjectView = Boolean(activeProjectId);
  elements.mapShell.classList.toggle("is-project-view", isProjectView);
  elements.apiLink.href = isProjectView && !explicitApiUrl ? defaultApiUrl(activeProjectId) : apiUrl;

  allFeaturesLayer = L.geoJSON(
    {
      ...fullFeatureCollection,
      features: visibleFeatures
    },
    {
      filter: hasRenderableGeometry,
      pointToLayer,
      style: styleFeature,
      onEachFeature
    }
  ).addTo(map);

  projectLayers = collectProjectLayers(allFeaturesLayer);
  renderProjectList(projects, allZones, allTrees);
  updateStats(visibleProjects.length, visibleZones.length, visibleTrees.length, visibleFeatures.length);

  if (fit) {
    fitVisibleMap();
  }

  if (activeProjectId && activeProject) {
    const projectName = activeProject.properties?.name || `Project ${activeProjectId}`;
    setStatus(projectName);
    return;
  }

  setStatus(`${projects.length} Silvi projects, ${allZones.length} verified geography zones, and ${allTrees.length} trees loaded.`);
}

function fitVisibleMap() {
  const bounds = allFeaturesLayer?.getBounds();
  if (bounds?.isValid()) {
    map.fitBounds(bounds, { padding: [42, 42], maxZoom: activeProjectId ? 16 : 14 });
  }
}

function pointToLayer(feature, latlng) {
  const kind = feature.properties?.kind;
  const isProject = kind === "project";
  const isTree = kind === "tree";
  return L.circleMarker(latlng, {
    radius: isProject ? 6 : isTree ? 5 : 4,
    color: "#ffffff",
    weight: 2,
    fillColor: isProject ? "#171717" : isTree ? "#0f8a4b" : "#0a72ef",
    fillOpacity: 0.96
  });
}

function styleFeature(feature) {
  const kind = feature.properties?.kind;

  if (kind === "zone") {
    return {
      color: "#0a72ef",
      fillColor: "#0a72ef",
      fillOpacity: 0.14,
      opacity: 0.82,
      weight: 2
    };
  }

  if (kind === "tree") {
    return {
      color: "#ffffff",
      fillColor: "#0f8a4b",
      fillOpacity: 0.96,
      opacity: 0.96,
      weight: 2
    };
  }

  return {
    color: "#171717",
    fillColor: "#171717",
    fillOpacity: 0.92,
    opacity: 0.92,
    weight: 2
  };
}

function onEachFeature(feature, layer) {
  layer.on("click", () => renderFeatureDetails(feature));
}

function collectProjectLayers(layerGroup) {
  const layers = new Map();

  layerGroup.eachLayer((layer) => {
    const properties = layer.feature?.properties || {};
    const projectId = properties.kind === "project" ? properties.id : properties.projectId;
    if (projectId === undefined || projectId === null) {
      return;
    }

    const key = String(projectId);
    const entries = layers.get(key) || [];
    entries.push(layer);
    layers.set(key, entries);
  });

  return layers;
}

function renderProjectList(projects, zones, trees) {
  elements.projectList.replaceChildren();

  for (const project of projects) {
    const properties = project.properties || {};
    const projectId = String(properties.id);
    const projectZones = zones.filter((zone) => String(zone.properties?.projectId) === projectId);
    const projectTrees = trees.filter((tree) => String(tree.properties?.projectId) === projectId);
    const zoneCount = projectZones.length;
    const treeCount = projectTrees.length;
    const isActive = activeProjectId === projectId;

    const item = document.createElement("div");
    item.className = `project-item${isActive ? " is-active" : ""}`;

    const mainButton = document.createElement("button");
    mainButton.className = "project-main";
    mainButton.type = "button";
    mainButton.setAttribute("aria-pressed", String(isActive));
    mainButton.innerHTML = `
      <span class="project-dot ${treeCount > 0 ? "has-trees" : ""}" aria-hidden="true"></span>
      <span class="project-name">${escapeHtml(properties.name || `Project ${projectId}`)}</span>
      <span class="project-meta">${zoneCount} zone${zoneCount === 1 ? "" : "s"} · ${treeCount} tree${treeCount === 1 ? "" : "s"}</span>
    `;
    mainButton.addEventListener("click", () => setProjectFilter(projectId));

    const filterButton = document.createElement("button");
    filterButton.className = "project-icon-button";
    filterButton.type = "button";
    filterButton.title = isActive ? "Show all maps" : "Show only this map";
    filterButton.setAttribute("aria-label", isActive ? "Show all maps" : `Show only ${properties.name || `Project ${projectId}`}`);
    filterButton.setAttribute("aria-pressed", String(isActive));
    filterButton.innerHTML = FILTER_ICON;
    filterButton.addEventListener("click", () => setProjectFilter(projectId));

    const openLink = document.createElement("a");
    openLink.className = "project-icon-button";
    openLink.href = projectMapUrl(projectId);
    openLink.target = "_blank";
    openLink.rel = "noreferrer";
    openLink.title = "Open filtered map";
    openLink.setAttribute("aria-label", `Open filtered map for ${properties.name || `Project ${projectId}`}`);
    openLink.innerHTML = OPEN_ICON;

    item.append(mainButton, filterButton, openLink);
    elements.projectList.append(item);
  }
}

function setProjectFilter(projectId) {
  activeProjectId = activeProjectId === String(projectId) ? null : String(projectId);
  syncProjectUrl();

  closeDetailPanel();
  renderCurrentView({ fit: true });
}

function matchesActiveProject(feature) {
  const properties = feature.properties || {};
  const projectId = properties.kind === "project" ? properties.id : properties.projectId;
  return String(projectId) === activeProjectId;
}

function projectMapUrl(projectId) {
  const url = new URL(window.location.href);
  url.searchParams.delete("api");
  url.searchParams.set("project", String(projectId));
  return url.href;
}

function syncProjectUrl() {
  const url = new URL(window.location.href);
  if (activeProjectId) {
    url.searchParams.set("project", activeProjectId);
  } else {
    url.searchParams.delete("project");
  }
  window.history.replaceState({}, "", url);
}

function updateStats(projectCount, zoneCount, treeCount, featureCount) {
  elements.projectCount.textContent = String(projectCount);
  elements.zoneCount.textContent = String(zoneCount);
  elements.treeCount.textContent = String(treeCount);
  elements.featureCount.textContent = String(featureCount);
}

function setStatus(message, isError = false) {
  elements.statusText.textContent = message;
  elements.statusText.classList.toggle("error-state", isError);
}

function showLoader(message, isError = false) {
  window.clearTimeout(loaderHideTimeout);
  loaderShownAt = performance.now();
  elements.mapLoader.hidden = false;
  elements.mapLoaderText.textContent = message;
  elements.mapLoader.classList.toggle("is-error", isError);
  elements.mapShell.classList.add("is-loading");
}

function hideLoader() {
  const elapsed = performance.now() - loaderShownAt;
  const remaining = Math.max(0, MIN_LOADER_VISIBLE_MS - elapsed);
  window.clearTimeout(loaderHideTimeout);
  loaderHideTimeout = window.setTimeout(() => {
    elements.mapLoader.hidden = true;
    elements.mapLoader.classList.remove("is-error");
    elements.mapShell.classList.remove("is-loading");
  }, remaining);
}

function renderFeatureDetails(feature) {
  const properties = feature.properties || {};
  const kind = properties.kind || "feature";
  const title = properties.name || properties.projectName || properties.zoneName || properties.id || "Silvi feature";
  const subtitle = subtitleForFeature(properties);

  elements.detailKind.textContent = kindLabel(kind);
  elements.detailTitle.textContent = String(title);
  elements.detailSubtitle.textContent = subtitle;
  renderClaimDetails(properties);
  renderMediaDetails(extractMediaAssets(properties));
  elements.detailFactsTitle.textContent = detailFactsTitle(kind);
  renderDetailFacts(factsForFeature(feature));
  elements.detailRaw.textContent = JSON.stringify(rawDetailsForFeature(feature), null, 2);
  elements.rawSection.hidden = true;
  elements.detailRawButton.setAttribute("aria-expanded", "false");
  elements.detailPanel.hidden = false;
  elements.mapShell.classList.add("has-detail");
}

function closeDetailPanel() {
  elements.detailPanel.hidden = true;
  elements.mapShell.classList.remove("has-detail");
}

function toggleRawDetails() {
  const nextExpanded = elements.rawSection.hidden;
  elements.rawSection.hidden = !nextExpanded;
  elements.detailRawButton.setAttribute("aria-expanded", String(nextExpanded));
}

function renderClaimDetails(properties) {
  elements.claimSection.hidden = properties.kind !== "tree";
  if (properties.kind !== "tree") {
    elements.claimList.replaceChildren();
    return;
  }

  const claimRows = [
    ["Status", properties.claimId ? "Linked" : "Not linked"],
    ["Type", properties.claimType],
    ["Amount", properties.claimAmount ? `${properties.claimAmount} USDC` : null],
    ["Approved", formatBoolean(properties.claimApproved)],
    ["Timestamp", formatDate(properties.claimTimestamp)],
    ["Goal", properties.claimGoal],
    ["Creator", properties.claimCreator],
    ["Notes", properties.claimNotes]
  ];

  renderDefinitionList(elements.claimList, claimRows);
}

function renderMediaDetails(mediaAssets) {
  elements.mediaGrid.replaceChildren();
  elements.mediaSection.hidden = mediaAssets.length === 0;

  for (const asset of mediaAssets.slice(0, 6)) {
    const link = document.createElement("a");
    link.className = "media-card";
    link.href = asset.href;
    link.target = "_blank";
    link.rel = "noreferrer";

    const image = document.createElement("img");
    image.src = asset.href;
    image.alt = asset.title || "Silvi evidence photo";
    image.loading = "lazy";

    const caption = document.createElement("span");
    caption.className = "media-caption";
    caption.textContent = asset.title || asset.source || "Evidence photo";

    link.append(image, caption);
    elements.mediaGrid.append(link);
  }
}

function renderDetailFacts(rows) {
  renderDefinitionList(elements.detailFacts, rows);
}

function renderDefinitionList(target, rows) {
  target.replaceChildren();
  for (const [label, value] of rows) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = String(value);
    target.append(term, detail);
  }
}

function factsForFeature(feature) {
  const properties = feature.properties || {};
  const coordinates = firstCoordinate(feature.geometry);

  if (properties.kind === "tree") {
    return [
      ["Project", properties.projectName],
      ["Tree ID", properties.id],
      ["Species", properties.species],
      ["Scientific", properties.scientificName],
      ["Health", properties.health],
      ["Height", properties.height ? `${properties.height}${properties.heightUnit ? ` ${properties.heightUnit}` : ""}` : null],
      ["Verified", formatBoolean(properties.verified)],
      ["Source", properties.source],
      ["Updated", formatDate(properties.updatedAt)],
      ["Coordinates", coordinates]
    ];
  }

  if (properties.kind === "zone") {
    return [
      ["Project", properties.projectName],
      ["Zone ID", properties.zoneId || properties.id],
      ["Zone", properties.zoneName || properties.name],
      ["Type", properties.zoneType],
      ["Status", properties.status],
      ["Coordinates", coordinates]
    ];
  }

  return [
    ["Project ID", properties.id],
    ["Status", properties.status],
    ["Country", properties.country],
    ["Updated", formatDate(properties.updatedAt)],
    ["Coordinates", coordinates],
    ["Description", properties.description]
  ];
}

function rawDetailsForFeature(feature) {
  const properties = feature.properties || {};
  return properties.rawData || {
    geometry: feature.geometry,
    properties
  };
}

function extractMediaAssets(properties) {
  const rawData = properties.rawData || {};
  const sources = [
    ["Tree", rawData.tree?.assets],
    ["Claim", rawData.claim?.assets]
  ];
  const seen = new Set();
  const media = [];

  for (const [source, assets] of sources) {
    if (!assets || typeof assets !== "object") {
      continue;
    }

    for (const asset of Object.values(assets)) {
      if (!asset?.href || seen.has(asset.href)) {
        continue;
      }

      const type = String(asset.type || "");
      const roles = Array.isArray(asset.roles) ? asset.roles.join(" ") : "";
      if (!type.startsWith("image/") && !roles.includes("thumbnail")) {
        continue;
      }

      seen.add(asset.href);
      media.push({
        href: asset.href,
        title: asset.title,
        source
      });
    }
  }

  return media;
}

function subtitleForFeature(properties) {
  if (properties.kind === "tree") {
    return [properties.projectName, properties.claimType || "No claim linked"].filter(Boolean).join(" · ");
  }

  if (properties.kind === "zone") {
    return [properties.projectName, properties.zoneType].filter(Boolean).join(" · ");
  }

  return [properties.status, properties.country].filter(Boolean).join(" · ");
}

function kindLabel(kind) {
  return {
    project: "Project",
    tree: "Tree",
    zone: "Zone"
  }[kind] || "Feature";
}

function detailFactsTitle(kind) {
  return {
    project: "Project details",
    tree: "Tree details",
    zone: "Zone details"
  }[kind] || "Details";
}

function formatBoolean(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return value === true || value === "true" ? "Yes" : "No";
}

function formatDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function firstCoordinate(geometry) {
  const coordinate = firstCoordinatePair(geometry?.coordinates);
  return coordinate ? `${coordinate[1].toFixed(6)}, ${coordinate[0].toFixed(6)}` : null;
}

function firstCoordinatePair(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
    return [Number(value[0]), Number(value[1])];
  }

  for (const entry of value) {
    const coordinate = firstCoordinatePair(entry);
    if (coordinate) {
      return coordinate;
    }
  }

  return null;
}

function hasRenderableGeometry(feature) {
  return Boolean(feature?.geometry?.type && Array.isArray(feature.geometry.coordinates));
}

function defaultApiUrl(projectId = null) {
  const pathname = projectId
    ? `/api/silvi/projects/${encodeURIComponent(projectId)}/map.geojson`
    : "/api/silvi/map.geojson";

  if (window.location.protocol === "file:") {
    return `http://localhost:4317${pathname}`;
  }

  return new URL(pathname, window.location.origin).href;
}

function sourceLabel(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes("localhost") || parsed.hostname === "127.0.0.1" ? "local" : parsed.hostname;
  } catch {
    return "custom";
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return entities[character];
  });
}
