import { getConfig, requireApiKey } from "./config.mjs";

const PROJECT_RESOURCE_PATHS = {
  gis: "gis",
  images: "images",
  logs: "logs",
  "potted-beds": "potted-beds",
  "seed-beds": "seed-beds",
  stac: "stac",
  trees: "trees",
  zones: "zones"
};

const MAX_STAC_PAGES = 100;
const STAC_PAGE_CONCURRENCY = 6;

export class SilviUpstreamError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "SilviUpstreamError";
    this.code = options.code || "SILVI_UPSTREAM_ERROR";
    this.statusCode = options.statusCode || 502;
    this.details = options.details;
  }
}

export async function readSilviProjects(options = {}) {
  const config = options.config || getConfig();
  requireApiKey(config);

  const upstreamUrl = buildSilviUrl(config, config.projectsPath, options.searchParams);
  const raw = await fetchSilviJson(upstreamUrl, config);
  const projects = extractProjects(raw);
  const featureCollection = toFeatureCollection(projects);

  const response = {
    fetchedAt: new Date().toISOString(),
    upstream: {
      baseUrl: config.baseUrl,
      path: config.projectsPath,
      status: "ok"
    },
    count: projects.length,
    mappedCount: featureCollection.features.length,
    projects,
    featureCollection
  };

  if (config.includeRaw) {
    response.raw = raw;
  }

  return response;
}

export async function readSilviRoot(options = {}) {
  const config = options.config || getConfig();
  requireApiKey(config);

  return fetchSilviJson(buildSilviUrl(config, "/", options.searchParams), config);
}

export async function readSilviGis(options = {}) {
  const config = options.config || getConfig();
  requireApiKey(config);

  return fetchSilviJson(buildSilviUrl(config, "/gis/", options.searchParams), config);
}

export async function readSilviProject(projectId, options = {}) {
  const config = options.config || getConfig();
  requireApiKey(config);

  assertProjectId(projectId);
  const path = `/projects/${encodeURIComponent(projectId)}/`;
  return fetchSilviJson(buildSilviUrl(config, path, options.searchParams), config);
}

export async function readSilviProjectMap(projectId, options = {}) {
  const config = options.config || getConfig();
  requireApiKey(config);
  assertProjectId(projectId);

  const [projectResult, zonesResult, treesResult] = await Promise.allSettled([
    readSilviProject(projectId, { config, searchParams: options.searchParams }),
    readSilviProjectResource(projectId, "zones", { config, searchParams: options.searchParams }),
    readSilviProjectTrees(projectId, { config })
  ]);

  if (projectResult.status === "rejected") {
    throw projectResult.reason;
  }

  const project = projectResult.value;
  const zones = zonesResult.status === "fulfilled" ? extractCollection(zonesResult.value?.zones || zonesResult.value) : [];
  const trees = treesResult.status === "fulfilled" ? treesResult.value : [];
  const featureCollection = toMapFeatureCollection(
    [project],
    [{ project, zones }],
    [{ project, trees }],
    { includeRawData: config.includeRaw }
  );

  return {
    fetchedAt: new Date().toISOString(),
    upstream: {
      baseUrl: config.baseUrl,
      path: `/projects/${encodeURIComponent(projectId)}/`,
      status: "ok"
    },
    count: 1,
    treeCount: trees.length,
    mappedCount: featureCollection.features.length,
    projects: [project],
    featureCollection
  };
}

export async function readSilviProjectResource(projectId, resource, options = {}) {
  const config = options.config || getConfig();
  requireApiKey(config);

  assertProjectId(projectId);
  const resourcePath = PROJECT_RESOURCE_PATHS[resource];
  if (!resourcePath) {
    throw new SilviUpstreamError("Unsupported Silvi project resource", {
      code: "SILVI_UNSUPPORTED_RESOURCE",
      statusCode: 404,
      details: Object.keys(PROJECT_RESOURCE_PATHS)
    });
  }

  const path = `/projects/${encodeURIComponent(projectId)}/${resourcePath}/`;
  return fetchSilviJson(buildSilviUrl(config, path, options.searchParams), config);
}

async function readSilviProjectResourceCollection(projectId, resource, options = {}) {
  const searchParams = cloneSearchParams(options.searchParams);
  if (!searchParams.has("page_size")) {
    searchParams.set("page_size", "1000");
  }

  let page = 1;
  let results = [];
  let numPages = 1;

  do {
    searchParams.set("page", String(page));
    const payload = await readSilviProjectResource(projectId, resource, {
      ...options,
      searchParams
    });
    results = results.concat(extractCollection(payload?.[resource] || payload));
    numPages = Number(payload?.num_pages || payload?.numPages || 1);
    page += 1;
  } while (page <= numPages);

  return results;
}

async function readSilviProjectTrees(projectId, options = {}) {
  const config = options.config || getConfig();
  let endpointTrees = [];
  let stacTrees = [];
  let stacClaims = [];

  const [endpointResult, stacResult] = await Promise.allSettled([
    readSilviProjectResourceCollection(projectId, "trees", { config }),
    readSilviProjectResource(projectId, "stac", { config })
  ]);

  if (endpointResult.status === "fulfilled") {
    endpointTrees = endpointResult.value;
  }

  if (stacResult.status === "fulfilled") {
    const [treeGroups, claimGroups] = await Promise.all([
      readStacFeatureCollections(extractStacItemUrls(stacResult.value, "trees"), { config }),
      readStacFeatureCollections(extractStacItemUrls(stacResult.value, "logs"), { config })
    ]);
    stacTrees = treeGroups;
    stacClaims = claimGroups;
  }

  return mergeTreeClaims(uniqueTrees([...endpointTrees, ...stacTrees]), stacClaims);
}

async function readStacFeatureCollections(urls, options = {}) {
  const featureGroups = await readSettledBatches(
    urls,
    (url) => readStacFeatureCollection(url, options),
    STAC_PAGE_CONCURRENCY
  );
  return featureGroups.flat();
}

async function readStacFeatureCollection(firstUrl, options = {}) {
  const config = options.config || getConfig();
  const firstPageUrl = new URL(firstUrl);
  const firstPayload = await fetchSilviPublicJson(firstPageUrl, config);
  const features = [];

  features.push(...extractCollection(firstPayload?.features || firstPayload));

  const remainingPageUrls = buildStacPageUrls(firstPageUrl, firstPayload);
  if (remainingPageUrls.length > 0) {
    const payloads = await readSettledBatches(
      remainingPageUrls,
      (url) => fetchSilviPublicJson(url, config),
      STAC_PAGE_CONCURRENCY
    );
    for (const payload of payloads) {
      features.push(...extractCollection(payload?.features || payload));
    }
    return features;
  }

  let nextUrl = firstPayload?.links?.find((link) => link?.rel === "next")?.href;
  let page = 1;
  while (nextUrl && page < MAX_STAC_PAGES) {
    page += 1;
    const payload = await fetchSilviPublicJson(new URL(nextUrl, firstPageUrl), config);
    features.push(...extractCollection(payload?.features || payload));

    const nextHref = payload?.links?.find((link) => link?.rel === "next")?.href;
    nextUrl = nextHref || null;
  }

  return features;
}

function buildStacPageUrls(firstPageUrl, payload) {
  const context = payload?.context || {};
  const matched = Number(context.matched);
  const limit = Number(context.limit || firstPageUrl.searchParams.get("limit"));
  const currentPage = Number(context.page || firstPageUrl.searchParams.get("page") || 1);

  if (!Number.isFinite(matched) || !Number.isFinite(limit) || limit <= 0) {
    return [];
  }

  const totalPages = Math.min(Math.ceil(matched / limit), MAX_STAC_PAGES);
  if (totalPages <= currentPage) {
    return [];
  }

  const urls = [];
  for (let page = currentPage + 1; page <= totalPages; page += 1) {
    const url = new URL(firstPageUrl);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));
    urls.push(url);
  }

  return urls;
}

async function readSettledBatches(items, reader, concurrency) {
  const results = [];

  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    const settled = await Promise.allSettled(batch.map(reader));
    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      }
    }
  }

  return results;
}

export async function readSilviMap(options = {}) {
  const config = options.config || getConfig();
  const includeZones = options.includeZones !== false;
  const includeTrees = options.includeTrees !== false;
  const projectsPayload = await readSilviProjects({ config, searchParams: options.searchParams });
  const projects = projectsPayload.projects;

  let zoneResults = [];
  if (includeZones) {
    zoneResults = await Promise.all(
      projects.map(async (project) => {
        const projectId = firstValue(project, ["id", "project_id", "projectId"]);
        const embeddedZones = extractCollection(project?.zones);
        if (embeddedZones.length > 0 || !projectId) {
          return { project, zones: embeddedZones };
        }

        try {
          const zonesPayload = await readSilviProjectResource(projectId, "zones", { config });
          return { project, zones: extractCollection(zonesPayload?.zones || zonesPayload) };
        } catch (error) {
          return { project, zones: [], error };
        }
      })
    );
  }

  let treeResults = [];
  if (includeTrees) {
    treeResults = await Promise.all(
      projects.map(async (project) => {
        const projectId = firstValue(project, ["id", "project_id", "projectId"]);
        const embeddedTrees = extractCollection(project?.trees);
        if (embeddedTrees.length > 0 || !projectId) {
          return { project, trees: embeddedTrees };
        }

        try {
          const trees = await readSilviProjectTrees(projectId, { config });
          return { project, trees };
        } catch (error) {
          return { project, trees: [], error };
        }
      })
    );
  }

  const featureCollection = toMapFeatureCollection(projects, zoneResults, treeResults, { includeRawData: config.includeRaw });

  return {
    fetchedAt: projectsPayload.fetchedAt,
    upstream: projectsPayload.upstream,
    count: projects.length,
    treeCount: treeResults.reduce((total, result) => total + (result.trees?.length || 0), 0),
    mappedCount: featureCollection.features.length,
    projects,
    featureCollection
  };
}

export function buildSilviUrl(config, path, searchParams = new URLSearchParams()) {
  const url = new URL(path.replace(/^\/+/, ""), `${config.baseUrl}/`);

  for (const [key, value] of searchParams) {
    if (!key.startsWith("_")) {
      url.searchParams.append(key, value);
    }
  }

  if (config.authMode === "query") {
    url.searchParams.set(config.authQueryParam, config.apiKey);
  }

  return url;
}

export async function fetchSilviJson(url, config) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: buildHeaders(config),
      signal: controller.signal
    });

    const body = await response.text();

    if (!response.ok) {
      throw new SilviUpstreamError(`Silvi API returned ${response.status}`, {
        statusCode: response.status >= 500 ? 502 : response.status,
        details: safePreview(body)
      });
    }

    try {
      return body ? JSON.parse(body) : null;
    } catch (error) {
      throw new SilviUpstreamError("Silvi API returned invalid JSON", {
        details: safePreview(body)
      });
    }
  } catch (error) {
    if (error.name === "AbortError") {
      throw new SilviUpstreamError("Silvi API request timed out", {
        code: "SILVI_TIMEOUT"
      });
    }

    if (error instanceof SilviUpstreamError) {
      throw error;
    }

    throw new SilviUpstreamError("Silvi API request failed", {
      details: error.message
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSilviPublicJson(url, config) {
  return fetchSilviJson(url, {
    ...config,
    apiKey: "",
    authMode: "query"
  });
}

export function buildHeaders(config) {
  const headers = {
    Accept: "application/json"
  };

  if (config.authMode !== "header") {
    return headers;
  }

  const authHeader = config.authHeader.trim();
  const authScheme = config.authScheme.trim();
  headers[authHeader] = authScheme ? `${authScheme} ${config.apiKey}` : config.apiKey;
  return headers;
}

export function extractProjects(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }

  const candidates = [
    raw?.projects,
    raw?.data?.projects,
    raw?.data,
    raw?.results,
    raw?.items,
    raw?.features
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return raw ? [raw] : [];
}

export function extractCollection(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }

  const candidates = [
    raw?.zones,
    raw?.trees,
    raw?.logs,
    raw?.images,
    raw?.seed_beds,
    raw?.seedBeds,
    raw?.potted_beds,
    raw?.pottedBeds,
    raw?.data,
    raw?.results,
    raw?.items,
    raw?.features
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return raw ? [raw] : [];
}

export function toFeatureCollection(projects) {
  return {
    type: "FeatureCollection",
    features: projects.map(toFeature).filter(Boolean)
  };
}

export function toMapFeatureCollection(projects, zoneResults = [], treeResults = [], options = {}) {
  const zoneFeatures = [];
  const treeFeatures = [];
  const zoneByProjectId = new Map();
  const treesByProjectId = new Map();

  for (const result of zoneResults) {
    const projectId = firstValue(result.project, ["id", "project_id", "projectId"]);
    if (projectId !== null) {
      zoneByProjectId.set(String(projectId), result.zones || []);
    }
  }

  for (const result of treeResults) {
    const projectId = firstValue(result.project, ["id", "project_id", "projectId"]);
    if (projectId !== null) {
      treesByProjectId.set(String(projectId), result.trees || []);
    }
  }

  for (const project of projects) {
    const projectId = firstValue(project, ["id", "project_id", "projectId"]);
    const projectName = firstValue(project, ["name", "title", "displayName", "projectName"]);
    const zones = zoneByProjectId.get(String(projectId)) || extractCollection(project?.zones);
    const trees = treesByProjectId.get(String(projectId)) || extractCollection(project?.trees);

    for (const zone of zones) {
      const feature = toZoneFeature(zone, project, { projectId, projectName });
      if (feature) {
        zoneFeatures.push(feature);
      }
    }

    for (const tree of trees) {
      const feature = toTreeFeature(tree, project, { projectId, projectName }, options);
      if (feature) {
        treeFeatures.push(feature);
      }
    }
  }

  const projectFeatures = projects
    .map((project) => {
      const feature = toFeature(project);
      if (feature) {
        return feature;
      }

      const projectId = firstValue(project, ["id", "project_id", "projectId"]);
      const zones = zoneByProjectId.get(String(projectId)) || extractCollection(project?.zones);
      return toProjectFeatureFromZones(project, zones);
    })
    .filter(Boolean);

  return {
    type: "FeatureCollection",
    features: [...zoneFeatures, ...projectFeatures, ...treeFeatures]
  };
}

function toFeature(project) {
  if (project?.type === "Feature" && project.geometry) {
    return project;
  }

  const coordinates = findCoordinates(project);
  if (!coordinates) {
    return null;
  }

  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates
    },
    properties: {
      kind: "project",
      id: firstValue(project, ["id", "uuid", "slug", "projectId", "externalId"]),
      name: firstValue(project, ["name", "title", "displayName", "projectName"]),
      status: firstValue(project, ["status", "state", "phase"]),
      description: firstValue(project, ["description", "summary"]),
      country: firstValue(project, ["country", "countryCode", "location.country"]),
      updatedAt: firstValue(project, ["updatedAt", "updated_at", "lastUpdatedAt"])
    }
  };
}

function toZoneFeature(zone, project, context) {
  const geometry = normalizeGeoJsonGeometry(zone?.geometry || zone?.geojson || zone?.polygon || zone?.boundary);
  if (!geometry) {
    return null;
  }

  const zoneId = firstValue(zone, ["id", "uuid", "zone_id", "zoneId"]);
  const zoneName = firstValue(zone, ["name", "title", "displayName"]);

  return {
    type: "Feature",
    geometry,
    properties: {
      kind: "zone",
      id: zoneId,
      name: zoneName || context.projectName || "Silvi zone",
      status: firstValue(project, ["status", "state", "phase"]),
      projectId: context.projectId,
      projectName: context.projectName,
      zoneId,
      zoneName,
      zoneType: firstValue(zone, ["type", "zone_type", "zoneType"]),
      updatedAt: firstValue(zone, ["updatedAt", "updated_at", "lastUpdatedAt"])
    }
  };
}

function toTreeFeature(tree, project, context, options = {}) {
  const pointGeometry = normalizeGeoJsonGeometry(tree?.point || tree?.geometry || tree?.geojson);
  const coordinates = pointGeometry?.type === "Point" ? normalizeCoordinatePair(pointGeometry.coordinates) : findCoordinates(tree);

  if (!coordinates) {
    return null;
  }

  const treeId = firstValue(tree, ["properties.id", "id", "uuid", "tree_id", "treeId"]);
  const commonName = firstValue(tree, [
    "properties.species_common_name",
    "species_common_name",
    "species",
    "species_name",
    "speciesName",
    "taxon",
    "name"
  ]);
  const scientificName = firstValue(tree, ["properties.species_scientific_name", "species_scientific_name", "scientificName"]);
  const species = commonName || scientificName;
  const title = firstValue(tree, ["properties.title", "properties.name", "title", "name"]);
  const height = firstValue(tree, ["properties.tree_height", "tree_height", "height"]);
  const heightUnit = firstValue(tree, ["properties.tree_height_unit", "tree_height_unit", "heightUnit"]);
  const source = (tree?.stac_version || tree?.properties?.model === "trees") ? "stac" : "api";
  const claim = tree?.claim || tree?.properties?.claim || null;
  const claimProperties = claim?.properties || claim || null;

  const properties = {
    kind: "tree",
    id: treeId,
    name: title || species || (treeId ? `Tree ${treeId}` : "Silvi tree"),
    projectId: context.projectId,
    projectName: context.projectName,
    species,
    scientificName,
    health: firstValue(tree, ["properties.tree_health_display", "health", "health_status", "healthStatus", "status"]),
    verified: firstValue(tree, ["properties.verified", "verified", "is_verified", "isVerified"]),
    height,
    heightUnit,
    trunkDiameter: firstValue(tree, ["properties.trunk_diameter", "trunk_diameter", "trunkDiameter"]),
    source,
    claimId: firstValue(claimProperties, ["id"]),
    claimType: firstValue(claimProperties, ["claim_type_display", "claim_type", "claimType"]),
    claimAmount: firstValue(claimProperties, ["claim_amount", "claimAmount"]),
    claimApproved: firstValue(claimProperties, ["claim_approved", "claimApproved"]),
    claimTimestamp: firstValue(claimProperties, ["timestamp", "datetime"]),
    claimNotes: firstValue(claimProperties, ["notes"]),
    claimGoal: firstValue(claimProperties, ["goal"]),
    claimCreator: firstValue(claimProperties, ["creator"]),
    updatedAt: firstValue(tree, ["properties.datetime", "updatedAt", "updated_at", "lastUpdatedAt"])
  };

  if (options.includeRawData) {
    properties.rawData = {
      tree: compactStacFeature(tree),
      claim: claim ? compactStacFeature(claim) : null
    };
  }

  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates
    },
    properties
  };
}

function toProjectFeatureFromZones(project, zones) {
  const coordinates = zones
    .map((zone) => normalizeGeoJsonGeometry(zone?.geometry || zone?.geojson || zone?.polygon || zone?.boundary))
    .flatMap(collectGeometryCoordinates);

  if (!coordinates.length) {
    return null;
  }

  const lon = coordinates.reduce((sum, coordinate) => sum + coordinate[0], 0) / coordinates.length;
  const lat = coordinates.reduce((sum, coordinate) => sum + coordinate[1], 0) / coordinates.length;
  const center = isValidLonLat(lon, lat) ? [lon, lat] : null;
  if (!center) {
    return null;
  }

  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: center
    },
    properties: {
      kind: "project",
      id: firstValue(project, ["id", "uuid", "slug", "projectId", "externalId"]),
      name: firstValue(project, ["name", "title", "displayName", "projectName"]),
      status: firstValue(project, ["status", "state", "phase"]),
      description: firstValue(project, ["description", "summary"]),
      country: firstValue(project, ["country", "countryCode", "location.country"]),
      updatedAt: firstValue(project, ["updatedAt", "updated_at", "lastUpdatedAt"])
    }
  };
}

function findCoordinates(value) {
  const directPair = normalizeCoordinatePair(value?.coordinates);
  if (directPair) {
    return directPair;
  }

  const pointPair = normalizeGeometry(normalizeGeoJsonGeometry(value?.point) || value?.point);
  if (pointPair) {
    return pointPair;
  }

  const geometryPair = normalizeGeometry(value?.geometry);
  if (geometryPair) {
    return geometryPair;
  }

  const locationPair = normalizeCoordinatePair(value?.location?.coordinates);
  if (locationPair) {
    return locationPair;
  }

  const centroidPair = normalizeCoordinatePair(value?.centroid?.coordinates || value?.centroid);
  if (centroidPair) {
    return centroidPair;
  }

  const bboxPair = normalizeBbox(value?.bbox || value?.boundingBox);
  if (bboxPair) {
    return bboxPair;
  }

  return normalizeLatLon(
    firstValue(value, ["latitude", "lat", "location.latitude", "location.lat"]),
    firstValue(value, ["longitude", "lng", "lon", "location.longitude", "location.lng", "location.lon"])
  );
}

function normalizeGeoJsonGeometry(value) {
  if (!value) {
    return null;
  }

  if (value.type === "Feature") {
    return normalizeGeoJsonGeometry(value.geometry);
  }

  if (value.type === "FeatureCollection") {
    const feature = value.features?.find((entry) => normalizeGeoJsonGeometry(entry.geometry));
    return feature ? normalizeGeoJsonGeometry(feature.geometry) : null;
  }

  if (typeof value === "string") {
    try {
      return normalizeGeoJsonGeometry(JSON.parse(value));
    } catch {
      return null;
    }
  }

  const allowed = new Set(["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"]);
  if (allowed.has(value.type) && Array.isArray(value.coordinates)) {
    return value;
  }

  return null;
}

function normalizeGeometry(geometry) {
  if (!geometry) {
    return null;
  }

  if (geometry.type === "Point") {
    return normalizeCoordinatePair(geometry.coordinates);
  }

  if (Array.isArray(geometry.coordinates)) {
    return findFirstCoordinatePair(geometry.coordinates);
  }

  return null;
}

function normalizeCoordinatePair(value) {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  if (!isNumericInput(value[0]) || !isNumericInput(value[1])) {
    return null;
  }

  const lon = Number(value[0]);
  const lat = Number(value[1]);
  return isValidLonLat(lon, lat) ? [lon, lat] : null;
}

function normalizeLatLon(latValue, lonValue) {
  if (!isNumericInput(latValue) || !isNumericInput(lonValue)) {
    return null;
  }

  const lat = Number(latValue);
  const lon = Number(lonValue);
  return isValidLonLat(lon, lat) ? [lon, lat] : null;
}

function normalizeBbox(value) {
  if (!Array.isArray(value) || value.length < 4) {
    return null;
  }

  if (!isNumericInput(value[0]) || !isNumericInput(value[1]) || !isNumericInput(value[2]) || !isNumericInput(value[3])) {
    return null;
  }

  const west = Number(value[0]);
  const south = Number(value[1]);
  const east = Number(value[2]);
  const north = Number(value[3]);
  const lon = (west + east) / 2;
  const lat = (south + north) / 2;
  return isValidLonLat(lon, lat) ? [lon, lat] : null;
}

function collectGeometryCoordinates(geometry) {
  if (!geometry?.coordinates) {
    return [];
  }

  return flattenCoordinatePairs(geometry.coordinates);
}

function flattenCoordinatePairs(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const pair = normalizeCoordinatePair(value);
  if (pair) {
    return [pair];
  }

  return value.flatMap(flattenCoordinatePairs);
}

function findFirstCoordinatePair(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const directPair = normalizeCoordinatePair(value);
  if (directPair) {
    return directPair;
  }

  for (const entry of value) {
    const nestedPair = findFirstCoordinatePair(entry);
    if (nestedPair) {
      return nestedPair;
    }
  }

  return null;
}

function isValidLonLat(lon, lat) {
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
}

function isNumericInput(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function cloneSearchParams(searchParams = new URLSearchParams()) {
  return new URLSearchParams(searchParams);
}

function extractStacItemUrls(value, collection, urls = new Set()) {
  if (!value || typeof value !== "object") {
    return [...urls];
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      extractStacItemUrls(item, collection, urls);
    }
    return [...urls];
  }

  const pattern = new RegExp(`/vector/${collection}/zones/[^/]+/items/?`, "i");
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && pattern.test(child)) {
      urls.add(child);
    }

    if (key === "href" && typeof child === "string" && pattern.test(child)) {
      urls.add(child);
    }

    extractStacItemUrls(child, collection, urls);
  }

  return [...urls];
}

function mergeTreeClaims(trees, claims) {
  const claimByTreeId = new Map();

  for (const claim of claims) {
    const treeId = firstValue(claim, ["properties.tree.id", "tree.id"]);
    if (treeId !== null && !claimByTreeId.has(String(treeId))) {
      claimByTreeId.set(String(treeId), claim);
    }
  }

  return trees.map((tree) => {
    const treeId = firstValue(tree, ["properties.id", "id", "uuid", "tree_id", "treeId"]);
    const claim = treeId !== null ? claimByTreeId.get(String(treeId)) : null;
    return claim ? { ...tree, claim } : tree;
  });
}

function uniqueTrees(trees) {
  const seen = new Set();
  const unique = [];

  for (const tree of trees) {
    const key = treeIdentity(tree);
    if (key && seen.has(key)) {
      continue;
    }

    if (key) {
      seen.add(key);
    }
    unique.push(tree);
  }

  return unique;
}

function treeIdentity(tree) {
  const id = firstValue(tree, ["properties.id", "id", "uuid", "tree_id", "treeId"]);
  if (id !== null) {
    return `id:${id}`;
  }

  const coordinates = findCoordinates(tree);
  return coordinates ? `point:${coordinates.join(",")}` : null;
}

function compactStacFeature(feature) {
  if (!feature || typeof feature !== "object") {
    return feature ?? null;
  }

  if (feature.type === "Feature") {
    return {
      id: feature.id ?? firstValue(feature, ["properties.id"]),
      type: feature.type,
      stacVersion: feature.stac_version,
      geometry: feature.geometry,
      bbox: feature.bbox,
      properties: feature.properties || {},
      assets: feature.assets || null,
      links: Array.isArray(feature.links)
        ? feature.links.map((link) => ({
            rel: link.rel,
            href: link.href,
            type: link.type,
            title: link.title
          }))
        : []
    };
  }

  return feature;
}

function firstValue(object, paths) {
  for (const path of paths) {
    const value = readPath(object, path);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

function readPath(object, path) {
  return path.split(".").reduce((current, key) => current?.[key], object);
}

function assertProjectId(projectId) {
  if (!String(projectId || "").trim()) {
    throw new SilviUpstreamError("projectId is required", {
      code: "SILVI_PROJECT_ID_REQUIRED",
      statusCode: 400
    });
  }
}

function safePreview(body) {
  return String(body || "").slice(0, 500);
}
