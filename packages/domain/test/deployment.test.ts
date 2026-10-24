import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment, InvalidDomainParams, type DeploymentDetails, type DeploymentSpec } from "../dist/index.js";

const SPEC: DeploymentSpec = { repo: "https://github.com/owner/repo", targetPort: 8080, maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 2 };
const DETAILS: DeploymentDetails = { id: "deployment", userId: "123", name: "sample-app", spec: SPEC };

test("deployment stores the creation specification and defaults progress fields", (): void => {
  const deployment: Deployment = new Deployment(DETAILS);
  assert.deepEqual(deployment.spec, { ...SPEC, envVars: {}, additionalPorts: undefined });
  assert.equal(deployment.status, "PENDING");
  assert.equal(deployment.image, null);
  assert.equal(deployment.buildId, null);
  assert.equal(deployment.resourceId, null);
  assert.equal(deployment.fqdn, null);
  assert.equal(deployment.error, null);
  assert.ok(deployment.createdAt instanceof Date);
  assert.equal(deployment.updatedAt, deployment.createdAt);
});

test("deployment copies nested environment variables and port mappings", (): void => {
  const variables: Record<string, string> = { NODE_ENV: "production" };
  const ports: { targetPort: number }[] = [{ targetPort: 9000 }];
  const deployment: Deployment = new Deployment({ ...DETAILS, spec: { ...SPEC, envVars: variables, additionalPorts: ports } });
  variables.NODE_ENV = "changed";
  ports[0]!.targetPort = 9001;
  assert.equal(deployment.spec?.envVars?.NODE_ENV, "production");
  assert.equal(deployment.spec?.additionalPorts?.[0]?.targetPort, 9000);
});

test("valid and invalid app names are checked against otherwise valid input", (): void => {
  const valid: string[] = ["ab", "web-app-1", "app01", "a".repeat(32)];
  valid.forEach((name: string): void => { assert.equal(new Deployment({ ...DETAILS, name }).name, name); });
  const invalid: string[] = ["SampleApp", "app_name", "a", "-start", "end-", "1start", "a".repeat(33)];
  invalid.forEach((name: string): void => { assert.throws((): Deployment => new Deployment({ ...DETAILS, name }), /Deployment.name/); });
  assert.throws((): Deployment => new Deployment({ ...DETAILS, id: " " }), /Deployment.id/);
  assert.throws((): Deployment => new Deployment({ ...DETAILS, userId: " " }), /Deployment.userId/);
});

test("each invalid specification fails for its intended validation rule", (): void => {
  const cases: { patch: Partial<DeploymentSpec>; message: RegExp }[] = [
    { patch: { maxVcpu: 0.3, maxMemory: 0.6 }, message: /Memory in GiB/ },
    { patch: { maxMemory: 2 }, message: /Memory in GiB/ },
    { patch: { minScaling: -1 }, message: /Scaling/ },
    { patch: { minScaling: 3 }, message: /Scaling/ },
    { patch: { maxScaling: 1.5 }, message: /Scaling/ },
    { patch: { repo: " " }, message: /repository/ },
    { patch: { targetPort: 65536 }, message: /Target port/ },
    { patch: { region: "Japan East" }, message: /Region/ },
    { patch: { dockerFilePath: "../Dockerfile" }, message: /inside the repository/ },
    { patch: { additionalPorts: [{ targetPort: 8080 }] }, message: /unique/ },
    { patch: { additionalPorts: [{ targetPort: 36985 }] }, message: /reserved port/ },
    { patch: { additionalPorts: [{ targetPort: 9000, exposedPort: 443, external: true }] }, message: /HTTP ingress/ },
    { patch: { external: "false" as unknown as boolean }, message: /external must be a boolean/ },
    { patch: { external: false, additionalPorts: [{ targetPort: 9000, external: true }] }, message: /require an external container/ },
  ];
  cases.forEach((item: { patch: Partial<DeploymentSpec>; message: RegExp }): void => {
    assert.throws((): Deployment => new Deployment({ ...DETAILS, spec: { ...SPEC, ...item.patch } }),
      (error: unknown): boolean => error instanceof InvalidDomainParams && item.message.test(error.message));
  });
});
