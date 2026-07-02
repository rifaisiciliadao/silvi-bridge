const DEFAULT_BASE_URL = "https://admin.staging.silvi.earth/public-api";
const DEFAULT_PROJECTS_PATH = "/projects/";
const DEFAULT_PORT = 4317;
const DEFAULT_TIMEOUT_MS = 12000;

export class SilviConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "SilviConfigError";
    this.code = "SILVI_CONFIG_ERROR";
    this.statusCode = 500;
  }
}

export function getConfig(env = process.env) {
  return {
    port: readInteger(env.PORT || env.SILVI_BRIDGE_PORT, DEFAULT_PORT),
    apiKey: env.SILVI_API_KEY || "",
    baseUrl: trimTrailingSlash(env.SILVI_API_BASE_URL || DEFAULT_BASE_URL),
    projectsPath: ensureLeadingSlash(env.SILVI_PROJECTS_PATH || DEFAULT_PROJECTS_PATH),
    authMode: readAuthMode(env.SILVI_AUTH_MODE),
    authQueryParam: env.SILVI_AUTH_QUERY_PARAM || "key",
    authHeader: env.SILVI_AUTH_HEADER || "Authorization",
    authScheme: env.SILVI_AUTH_SCHEME === undefined ? "Bearer" : env.SILVI_AUTH_SCHEME,
    allowedOrigin: env.SILVI_ALLOWED_ORIGIN || "*",
    requestTimeoutMs: readInteger(env.SILVI_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    includeRaw: env.SILVI_INCLUDE_RAW === "true"
  };
}

export function requireApiKey(config) {
  if (!config.apiKey.trim()) {
    throw new SilviConfigError("SILVI_API_KEY is required");
  }
}

function readInteger(value, fallback) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readAuthMode(value) {
  return value === "header" ? "header" : "query";
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function ensureLeadingSlash(value) {
  return value.startsWith("/") ? value : `/${value}`;
}
