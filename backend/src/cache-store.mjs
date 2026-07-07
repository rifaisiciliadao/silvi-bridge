import { createHash, createHmac } from "node:crypto";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const AWS_ALGORITHM = "AWS4-HMAC-SHA256";
const AWS_SERVICE = "s3";

export class SilviCacheError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "SilviCacheError";
    this.code = options.code || "SILVI_CACHE_ERROR";
    this.statusCode = options.statusCode || 502;
    this.details = options.details;
  }
}

export function createCacheStore(config) {
  if (!config.cacheEnabled) {
    return new NullCacheStore();
  }

  if (config.cacheBackend === "memory") {
    return new MemoryCacheStore();
  }

  if (config.cacheBackend === "spaces") {
    return new SpacesCacheStore(config);
  }

  throw new SilviCacheError("Unsupported Silvi cache backend", {
    code: "SILVI_CACHE_BACKEND_UNSUPPORTED",
    details: config.cacheBackend
  });
}

class NullCacheStore {
  backend = "disabled";

  async readJson() {
    return null;
  }

  async writeJson() {
    return null;
  }
}

export class MemoryCacheStore {
  backend = "memory";

  constructor() {
    this.objects = new Map();
  }

  async readJson(key) {
    const body = this.objects.get(key);
    return body ? JSON.parse(body) : null;
  }

  async writeJson(key, payload) {
    const body = JSON.stringify(payload);
    this.objects.set(key, body);
    return {
      key,
      bytes: Buffer.byteLength(body)
    };
  }
}

export class SpacesCacheStore {
  backend = "spaces";

  constructor(config) {
    this.config = config;
    validateSpacesConfig(config);
  }

  async readJson(key) {
    const response = await signedSpacesFetch(this.config, "GET", key);

    if (response.status === 404) {
      return null;
    }

    const body = await response.text();
    if (!response.ok) {
      throw new SilviCacheError(`Silvi cache read failed with ${response.status}`, {
        code: "SILVI_CACHE_READ_FAILED",
        details: safePreview(body)
      });
    }

    try {
      return body ? JSON.parse(body) : null;
    } catch {
      throw new SilviCacheError("Silvi cache object is not valid JSON", {
        code: "SILVI_CACHE_INVALID_JSON",
        details: key
      });
    }
  }

  async writeJson(key, payload) {
    const body = JSON.stringify(payload);
    const response = await signedSpacesFetch(this.config, "PUT", key, {
      body,
      contentType: JSON_CONTENT_TYPE
    });
    const responseBody = await response.text();

    if (!response.ok) {
      throw new SilviCacheError(`Silvi cache write failed with ${response.status}`, {
        code: "SILVI_CACHE_WRITE_FAILED",
        details: safePreview(responseBody)
      });
    }

    return {
      key,
      bytes: Buffer.byteLength(body),
      etag: response.headers.get("etag")
    };
  }
}

async function signedSpacesFetch(config, method, key, options = {}) {
  const url = buildSpacesObjectUrl(config, key);
  const body = options.body ? Buffer.from(options.body) : Buffer.alloc(0);
  const now = new Date();
  const amzDate = toAmzDate(now);
  const shortDate = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const host = url.host;
  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };

  if (options.contentType) {
    headers["content-type"] = options.contentType;
  }

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${normalizeHeaderValue(headers[name])}\n`)
    .join("");
  const credentialScope = `${shortDate}/${config.cacheSpacesRegion}/${AWS_SERVICE}/aws4_request`;
  const canonicalRequest = [
    method,
    canonicalUri(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const stringToSign = [
    AWS_ALGORITHM,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signature = hmacHex(signingKey(config.cacheSpacesSecretAccessKey, shortDate, config.cacheSpacesRegion), stringToSign);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.cacheRequestTimeoutMs);

  try {
    return await fetch(url, {
      method,
      headers: {
        ...headers,
        Authorization: `${AWS_ALGORITHM} Credential=${config.cacheSpacesAccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
      },
      body: method === "GET" || method === "HEAD" ? undefined : body,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new SilviCacheError("Silvi cache request timed out", {
        code: "SILVI_CACHE_TIMEOUT"
      });
    }

    throw new SilviCacheError("Silvi cache request failed", {
      code: "SILVI_CACHE_REQUEST_FAILED",
      details: error.message
    });
  } finally {
    clearTimeout(timeout);
  }
}

function buildSpacesObjectUrl(config, key) {
  const endpoint = new URL(config.cacheSpacesEndpoint);
  const bucketPrefix = `${config.cacheSpacesBucket}.`;

  if (!endpoint.hostname.startsWith(bucketPrefix)) {
    endpoint.hostname = `${config.cacheSpacesBucket}.${endpoint.hostname}`;
  }

  endpoint.pathname = joinPath(endpoint.pathname, config.cacheSpacesPrefix, key);
  endpoint.search = "";
  return endpoint;
}

function validateSpacesConfig(config) {
  const missing = [
    ["SILVI_CACHE_SPACES_BUCKET", config.cacheSpacesBucket],
    ["SILVI_CACHE_SPACES_ACCESS_KEY_ID", config.cacheSpacesAccessKeyId],
    ["SILVI_CACHE_SPACES_SECRET_ACCESS_KEY", config.cacheSpacesSecretAccessKey],
    ["SILVI_CACHE_SPACES_ENDPOINT", config.cacheSpacesEndpoint],
    ["SILVI_CACHE_SPACES_REGION", config.cacheSpacesRegion]
  ].filter(([, value]) => !String(value || "").trim());

  if (missing.length > 0) {
    throw new SilviCacheError("Silvi Spaces cache configuration is incomplete", {
      code: "SILVI_CACHE_CONFIG_INCOMPLETE",
      details: missing.map(([name]) => name)
    });
  }
}

function joinPath(...parts) {
  const joined = parts
    .map((part) => String(part || "").trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return `/${joined}`;
}

function canonicalUri(pathname) {
  return pathname
    .split("/")
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join("/");
}

function canonicalQuery(searchParams) {
  return [...searchParams.entries()]
    .sort(([aKey, aValue], [bKey, bValue]) => aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function normalizeHeaderValue(value) {
  return String(value).trim().replace(/\s+/g, " ");
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key, value) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function signingKey(secret, shortDate, region) {
  const dateKey = hmac(`AWS4${secret}`, shortDate);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, AWS_SERVICE);
  return hmac(serviceKey, "aws4_request");
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function safePreview(body) {
  return String(body || "").slice(0, 500);
}
