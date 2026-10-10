import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment, InvalidDomainParams, type DeploymentDetails } from "../dist/index.js";

const validDetails: DeploymentDetails = {
  id: "deploy-1",
  userId: "user-123",
  name: "sample-app",
  status: "PENDING",
  spec: {
    image: "nginx:alpine",
    targetPort: 80,
  },
};

test("Deployment entity creates successfully with valid parameters and defaults", (): void => {
  const deployment: Deployment = new Deployment(validDetails);

  assert.equal(deployment.id, "deploy-1");
  assert.equal(deployment.userId, "user-123");
  assert.equal(deployment.name, "sample-app");
  assert.equal(deployment.status, "PENDING");
  assert.equal(deployment.spec.image, "nginx:alpine");
  assert.equal(deployment.spec.targetPort, 80);
  assert.equal(deployment.spec.resources?.cpu, 0.25);
  assert.equal(deployment.spec.resources?.memory, 0.5);
  assert.equal(deployment.spec.scaling?.minReplicas, 0);
  assert.equal(deployment.spec.scaling?.maxReplicas, 2);
  assert.equal(deployment.spec.envVars, null);
  assert.equal(deployment.fqdn, null);
  assert.equal(deployment.errorMessage, null);
  assert.ok(deployment.createdAt instanceof Date);
  assert.ok(deployment.updatedAt instanceof Date);
});

test("Deployment entity creates successfully with custom configuration in spec", (): void => {
  const customDetails: DeploymentDetails = {
    ...validDetails,
    id: "deploy-2",
    name: "api-v2",
    spec: {
      image: "node:20-alpine",
      targetPort: 3000,
      resources: { cpu: 0.5, memory: 1.0 },
      scaling: { minReplicas: 1, maxReplicas: 5 },
      envVars: { NODE_ENV: "production" },
    },
    fqdn: "https://api-v2.internal.azurecontainerapps.io",
  };
  const deployment: Deployment = new Deployment(customDetails);

  assert.equal(deployment.spec.resources?.cpu, 0.5);
  assert.equal(deployment.spec.resources?.memory, 1.0);
  assert.equal(deployment.spec.scaling?.minReplicas, 1);
  assert.equal(deployment.spec.scaling?.maxReplicas, 5);
  assert.deepEqual(deployment.spec.envVars, { NODE_ENV: "production" });
  assert.equal(deployment.fqdn, "https://api-v2.internal.azurecontainerapps.io");
});

test("Deployment validation fails on blank id", (): void => {
  assert.throws(
    (): Deployment => new Deployment({ ...validDetails, id: "  " }),
    InvalidDomainParams,
  );
});

test("Deployment validation fails on blank userId", (): void => {
  assert.throws(
    (): Deployment => new Deployment({ ...validDetails, userId: "" }),
    InvalidDomainParams,
  );
});

test("Deployment validation fails on invalid Azure Container Apps app name", (): void => {
  const invalidNames: string[] = [
    "SampleApp", // Uppercase not allowed
    "app_name",  // Underscore not allowed
    "a",         // Too short (minimum 2 chars)
    "-start-hyphen", // Cannot start with hyphen
    "end-hyphen-",   // Cannot end with hyphen
    "1start-digit",  // Must start with letter
    "a".repeat(33),  // Too long (>32 chars)
  ];

  for (const invalidName of invalidNames) {
    assert.throws(
      (): Deployment => new Deployment({ ...validDetails, name: invalidName }),
      InvalidDomainParams,
      `Expected error for invalid name: ${invalidName}`,
    );
  }
});

test("Deployment validation succeeds on valid Azure Container Apps names", (): void => {
  const validNames: string[] = [
    "ab",
    "web-app-1",
    "app01",
    "my-container-app-service-2026",
  ];

  for (const validName of validNames) {
    const deployment: Deployment = new Deployment({ ...validDetails, name: validName });
    assert.equal(deployment.name, validName);
  }
});

test("Deployment validation fails on blank image in spec", (): void => {
  assert.throws(
    (): Deployment =>
      new Deployment({
        ...validDetails,
        spec: { image: "   ", targetPort: 80 },
      }),
    InvalidDomainParams,
  );
});

test("Deployment validation fails on invalid target port in spec", (): void => {
  const invalidPorts: number[] = [0, -80, 65536, 1.5];

  for (const port of invalidPorts) {
    assert.throws(
      (): Deployment =>
        new Deployment({
          ...validDetails,
          spec: { image: "nginx", targetPort: port },
        }),
      InvalidDomainParams,
      `Expected error for port: ${port}`,
    );
  }
});

test("Deployment validation fails when minReplicas is negative", (): void => {
  assert.throws(
    (): Deployment =>
      new Deployment({
        ...validDetails,
        spec: {
          image: "nginx",
          targetPort: 80,
          scaling: { minReplicas: -1 },
        },
      }),
    InvalidDomainParams,
  );
});

test("Deployment validation fails when maxReplicas is less than minReplicas", (): void => {
  assert.throws(
    (): Deployment =>
      new Deployment({
        ...validDetails,
        spec: {
          image: "nginx",
          targetPort: 80,
          scaling: { minReplicas: 3, maxReplicas: 2 },
        },
      }),
    InvalidDomainParams,
  );
});
