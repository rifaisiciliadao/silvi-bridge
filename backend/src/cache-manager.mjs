import { createCacheStore } from "./cache-store.mjs";
import {
  extractCollection,
  readSilviProject,
  readSilviProjectMap,
  readSilviProjectResource,
  readSilviProjects,
  toMapFeatureCollection
} from "./silvi-client.mjs";

export const SILVI_CACHE_KEYS = {
  manifest: "manifest.json",
  projects: "projects.json",
  projectsGeoJson: "projects.geojson",
  mapGeoJson: "map.geojson",
  project: (projectId) => `projects/${encodeCacheSegment(projectId)}.json`,
  projectMapGeoJson: (projectId) => `projects/${encodeCacheSegment(projectId)}/map.geojson`,
  projectZonesGeoJson: (projectId) => `projects/${encodeCacheSegment(projectId)}/zones.geojson`
};

export function createSilviCacheManager({ config, store = createCacheStore(config), logger = console } = {}) {
  let refreshTimer = null;
  let refreshPromise = null;
  let lastRefreshStartedAt = null;
  let lastRefreshFinishedAt = null;
  let lastError = null;

  async function readJson(key) {
    if (!config.cacheEnabled) {
      return null;
    }

    try {
      return await store.readJson(key);
    } catch (error) {
      lastError = toPublicError(error);
      logger.warn?.(`silvi cache read failed for ${key}: ${error.message}`);
      return null;
    }
  }

  async function readOrFresh(key, freshReader) {
    if (canUseCache()) {
      const cachedPayload = await readJson(key);
      if (cachedPayload) {
        return {
          payload: cachedPayload,
          cacheStatus: "HIT"
        };
      }
    }

    return {
      payload: await freshReader(),
      cacheStatus: canUseCache() ? "MISS" : "BYPASS"
    };
  }

  async function refresh() {
    if (!canUseCache()) {
      return null;
    }

    if (refreshPromise) {
      return refreshPromise;
    }

    lastRefreshStartedAt = new Date().toISOString();
    refreshPromise = refreshSilviCache({ config, store, logger })
      .then((manifest) => {
        lastError = null;
        lastRefreshFinishedAt = manifest.refreshedAt;
        return manifest;
      })
      .catch((error) => {
        lastError = toPublicError(error);
        logger.error?.(`silvi cache refresh failed: ${error.message}`);
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });

    return refreshPromise;
  }

  function start() {
    if (!canUseCache() || refreshTimer) {
      return;
    }

    if (config.cacheRefreshOnStart) {
      setTimeout(() => {
        refresh().catch(() => {});
      }, 0);
    }

    refreshTimer = setInterval(() => {
      refresh().catch(() => {});
    }, config.cacheRefreshIntervalMs);
    refreshTimer.unref?.();
  }

  function stop() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  async function manifest() {
    const cachedManifest = await readJson(SILVI_CACHE_KEYS.manifest);
    return {
      enabled: config.cacheEnabled,
      backend: store.backend,
      refreshIntervalMs: config.cacheRefreshIntervalMs,
      refreshInProgress: Boolean(refreshPromise),
      lastRefreshStartedAt,
      lastRefreshFinishedAt,
      lastError,
      manifest: cachedManifest
    };
  }

  function status() {
    return {
      enabled: config.cacheEnabled,
      backend: store.backend,
      refreshIntervalMs: config.cacheRefreshIntervalMs,
      refreshInProgress: Boolean(refreshPromise),
      lastRefreshStartedAt,
      lastRefreshFinishedAt,
      lastError
    };
  }

  function canUseCache() {
    return config.cacheEnabled && store.backend !== "disabled";
  }

  return {
    readJson,
    readOrFresh,
    refresh,
    start,
    stop,
    manifest,
    status
  };
}

export async function refreshSilviCache({ config, store, logger = console }) {
  const refreshedAt = new Date().toISOString();
  const projectsPayload = await readSilviProjects({ config });
  const projects = projectsPayload.projects || [];
  const projectResults = await mapWithConcurrency(
    projects,
    config.cacheProjectConcurrency,
    (project) => refreshProjectCache({ config, store, project, logger })
  );

  const errors = projectResults.filter((result) => result.status === "rejected").map((result) => result.reason);
  const successfulProjects = projectResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  const allFeatures = successfulProjects.flatMap((result) => result.featureCollection.features || []);
  const mapFeatureCollection = {
    type: "FeatureCollection",
    features: allFeatures
  };
  const manifest = {
    refreshedAt,
    upstreamFetchedAt: projectsPayload.fetchedAt,
    projectCount: projects.length,
    cachedProjectCount: successfulProjects.length,
    featureCount: allFeatures.length,
    treeCount: successfulProjects.reduce((total, result) => total + result.treeCount, 0),
    errors,
    keys: {
      projects: SILVI_CACHE_KEYS.projects,
      projectsGeoJson: SILVI_CACHE_KEYS.projectsGeoJson,
      mapGeoJson: SILVI_CACHE_KEYS.mapGeoJson
    },
    projects: successfulProjects.map((result) => ({
      id: result.projectId,
      name: result.projectName,
      treeCount: result.treeCount,
      mappedCount: result.mappedCount,
      keys: result.keys
    }))
  };

  await store.writeJson(SILVI_CACHE_KEYS.projects, projectsPayload);
  await store.writeJson(SILVI_CACHE_KEYS.projectsGeoJson, projectsPayload.featureCollection);
  await store.writeJson(SILVI_CACHE_KEYS.mapGeoJson, mapFeatureCollection);
  await store.writeJson(SILVI_CACHE_KEYS.manifest, manifest);
  logger.info?.(`silvi cache refreshed ${successfulProjects.length}/${projects.length} projects with ${allFeatures.length} features`);
  return manifest;
}

async function refreshProjectCache({ config, store, project, logger }) {
  const projectId = firstValue(project, ["id", "project_id", "projectId", "uuid", "slug"]);
  if (projectId === null) {
    throw publicProjectError(project, "Silvi project has no cacheable id");
  }

  const projectName = firstValue(project, ["name", "title", "displayName", "projectName"]);
  try {
    const [projectDetailResult, projectMapPayload, zonesPayload] = await Promise.all([
      readSilviProject(projectId, { config }).catch(() => project),
      readSilviProjectMap(projectId, { config }),
      readSilviProjectResource(projectId, "zones", { config }).catch(() => null)
    ]);
    const zones = extractCollection(zonesPayload?.zones || zonesPayload);
    const zonesFeatureCollection = zones.length > 0
      ? toMapFeatureCollection([projectDetailResult], [{ project: projectDetailResult, zones }], [], { includeRawData: config.includeRaw })
      : filterProjectZones(projectMapPayload.featureCollection);
    const keys = {
      project: SILVI_CACHE_KEYS.project(projectId),
      mapGeoJson: SILVI_CACHE_KEYS.projectMapGeoJson(projectId),
      zonesGeoJson: SILVI_CACHE_KEYS.projectZonesGeoJson(projectId)
    };

    await store.writeJson(keys.project, projectDetailResult);
    await store.writeJson(keys.mapGeoJson, projectMapPayload.featureCollection);
    await store.writeJson(keys.zonesGeoJson, zonesFeatureCollection);

    return {
      projectId,
      projectName,
      treeCount: projectMapPayload.treeCount || 0,
      mappedCount: projectMapPayload.mappedCount || projectMapPayload.featureCollection.features.length,
      featureCollection: projectMapPayload.featureCollection,
      keys
    };
  } catch (error) {
    logger.warn?.(`silvi cache project refresh failed for ${projectId}: ${error.message}`);
    throw {
      projectId,
      projectName,
      code: error.code || "SILVI_PROJECT_CACHE_FAILED",
      message: error.message || "Project cache refresh failed"
    };
  }
}

function filterProjectZones(featureCollection) {
  return {
    type: "FeatureCollection",
    features: (featureCollection.features || []).filter((feature) => {
      const kind = feature?.properties?.kind;
      return kind === "project" || kind === "zone";
    })
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const settled = [];
  const active = new Set();
  let index = 0;

  async function runNext() {
    if (index >= items.length) {
      return;
    }

    const currentIndex = index;
    index += 1;
    const promise = Promise.resolve()
      .then(() => mapper(items[currentIndex]))
      .then(
        (value) => {
          settled[currentIndex] = { status: "fulfilled", value };
        },
        (reason) => {
          settled[currentIndex] = { status: "rejected", reason };
        }
      )
      .finally(() => {
        active.delete(promise);
      });
    active.add(promise);
  }

  while (index < items.length || active.size > 0) {
    while (index < items.length && active.size < concurrency) {
      await runNext();
    }

    if (active.size > 0) {
      await Promise.race(active);
    }
  }

  return settled;
}

function publicProjectError(project, message) {
  return {
    projectName: firstValue(project, ["name", "title", "displayName", "projectName"]),
    code: "SILVI_PROJECT_CACHE_FAILED",
    message
  };
}

function toPublicError(error) {
  return {
    code: error.code || "SILVI_CACHE_ERROR",
    message: error.message || "Silvi cache error",
    details: error.details
  };
}

function firstValue(object, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((current, key) => current?.[key], object);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

function encodeCacheSegment(value) {
  return encodeURIComponent(String(value));
}
