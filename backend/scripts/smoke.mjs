import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readSilviMap, readSilviProjectMap, readSilviProjects } from "../src/silvi-client.mjs";
import { getConfig } from "../src/config.mjs";

const mockProjects = [
  {
    id: "rifai-test-1",
    name: "Rifai Sicilia Test Grove",
    status: "active",
    location: {
      lat: 37.5079,
      lng: 14.0825,
      country: "IT"
    },
    zones: [
      {
        id: "zone-1",
        name: "North grove",
        type: "restoration",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [14.05, 37.49],
              [14.11, 37.49],
              [14.11, 37.53],
              [14.05, 37.53],
              [14.05, 37.49]
            ]
          ]
        }
      }
    ],
    trees: [
      {
        id: "tree-1",
        point: {
          type: "Point",
          coordinates: [14.08, 37.5]
        },
        species: "Olea europaea",
        verified: true,
        health: "good"
      }
    ]
  }
];

const mockServer = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  assert.equal(request.headers.authorization, undefined);
  assert.equal(url.searchParams.get("key"), "test-key");

  response.setHeader("Content-Type", "application/json");

  if (url.pathname === "/projects/") {
    return response.end(JSON.stringify({ projects: mockProjects }));
  }

  if (url.pathname === "/projects/rifai-test-1/") {
    return response.end(JSON.stringify(mockProjects[0]));
  }

  if (url.pathname === "/projects/rifai-test-1/zones/") {
    return response.end(JSON.stringify({ zones: mockProjects[0].zones }));
  }

  if (url.pathname === "/projects/rifai-test-1/trees/") {
    return response.end(JSON.stringify({
      page: 1,
      page_size: 1000,
      num_pages: 1,
      trees: mockProjects[0].trees
    }));
  }

  response.statusCode = 404;
  response.end(JSON.stringify({ detail: "not found" }));
});

await new Promise((resolve) => mockServer.listen(0, resolve));

try {
  const address = mockServer.address();
  const config = getConfig({
    SILVI_API_KEY: "test-key",
    SILVI_API_BASE_URL: `http://127.0.0.1:${address.port}`,
    SILVI_PROJECTS_PATH: "/projects/",
    SILVI_AUTH_MODE: "query",
    SILVI_AUTH_QUERY_PARAM: "key",
    SILVI_REQUEST_TIMEOUT_MS: "1000"
  });

  const result = await readSilviProjects({ config });

  assert.equal(result.count, 1);
  assert.equal(result.mappedCount, 1);
  assert.equal(result.projects[0].name, "Rifai Sicilia Test Grove");
  assert.equal(result.featureCollection.features[0].geometry.coordinates[0], 14.0825);
  assert.equal(result.featureCollection.features[0].geometry.coordinates[1], 37.5079);

  const mapResult = await readSilviMap({ config });
  assert.equal(mapResult.count, 1);
  assert.equal(mapResult.treeCount, 1);
  assert.equal(mapResult.mappedCount, 3);
  assert.equal(mapResult.featureCollection.features[0].geometry.type, "Polygon");
  assert.equal(mapResult.featureCollection.features.find((feature) => feature.properties.kind === "tree").properties.species, "Olea europaea");

  const projectMapResult = await readSilviProjectMap("rifai-test-1", { config });
  assert.equal(projectMapResult.count, 1);
  assert.equal(projectMapResult.treeCount, 1);
  assert.equal(projectMapResult.mappedCount, 3);
  assert.equal(projectMapResult.featureCollection.features.find((feature) => feature.properties.kind === "tree").properties.projectId, "rifai-test-1");

  console.log("silvi-bridge smoke ok");
} finally {
  await new Promise((resolve) => mockServer.close(resolve));
}
