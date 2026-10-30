import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Deployment,
  InvalidDomainParams,
  validateDeploymentVolumes,
  type DeploymentDetails,
  type DeploymentSpec,
  type DeploymentVolume,
} from "../dist/index.js";

const BASE_SPEC: DeploymentSpec = {
  repo: "https://github.com/owner/repo",
  targetPort: 8080,
  maxVcpu: 0.5,
  maxMemory: 1,
  minScaling: 0,
  maxScaling: 2,
};

const BASE_DETAILS: DeploymentDetails = {
  id: "deployment",
  userId: "123",
  name: "sample-app",
  spec: BASE_SPEC,
};

test("validateDeploymentVolumes returns null for undefined or valid volume list", (): void => {
  const resultUndefined: InvalidDomainParams | null = validateDeploymentVolumes(undefined);
  assert.equal(resultUndefined, null);

  const validVolumes: readonly DeploymentVolume[] = [
    { name: "data", mountPath: "/var/data", sizeGb: 32, accessMode: "ReadWrite" },
    { name: "config", mountPath: "/app/config", sizeGb: 32, accessMode: "ReadOnly", subPath: "settings" },
  ];
  const resultValid: InvalidDomainParams | null = validateDeploymentVolumes(validVolumes, 100);
  assert.equal(resultValid, null);
});

test("validateDeploymentVolumes rejects non-array or invalid volume objects", (): void => {
  const nonArray: unknown = "not-an-array";
  const resultNonArray: InvalidDomainParams | null = validateDeploymentVolumes(nonArray as readonly DeploymentVolume[]);
  assert.ok(resultNonArray instanceof InvalidDomainParams);
  assert.match(resultNonArray.message, /must be an array/);

  const invalidObj: unknown[] = [null];
  const resultInvalidObj: InvalidDomainParams | null = validateDeploymentVolumes(invalidObj as readonly DeploymentVolume[]);
  assert.ok(resultInvalidObj instanceof InvalidDomainParams);
  assert.match(resultInvalidObj.message, /Invalid volume specification/);
});

test("validateDeploymentVolumes checks volume name constraints", (): void => {
  const invalidNames: string[] = ["", "A", "-lead", "trail-", "has_underscore", "toolong" + "a".repeat(30)];
  for (const name of invalidNames) {
    const res: InvalidDomainParams | null = validateDeploymentVolumes([{ name, mountPath: "/var/data", sizeGb: 32 }]);
    assert.ok(res instanceof InvalidDomainParams, `Expected failure for name: ${name}`);
    assert.match(res.message, /Volume name/);
  }
});

test("validateDeploymentVolumes checks mountPath constraints and critical paths", (): void => {
  const invalidPaths: string[] = ["relative/path", "/has:colon", "/path/with/\0null", "/path/../traversal"];
  for (const mountPath of invalidPaths) {
    const res: InvalidDomainParams | null = validateDeploymentVolumes([{ name: "data", mountPath, sizeGb: 32 }]);
    assert.ok(res instanceof InvalidDomainParams, `Expected failure for mountPath: ${mountPath}`);
    assert.match(res.message, /Volume mountPath must be a valid absolute Linux path/);
  }

  const criticalPaths: string[] = ["/", "/bin", "/sbin", "/etc", "/dev", "/proc", "/sys", "/root", "/usr", "/etc/"];
  for (const mountPath of criticalPaths) {
    const res: InvalidDomainParams | null = validateDeploymentVolumes([{ name: "data", mountPath, sizeGb: 32 }]);
    assert.ok(res instanceof InvalidDomainParams, `Expected failure for critical path: ${mountPath}`);
    assert.match(res.message, /critical system path/);
  }
});

test("validateDeploymentVolumes checks subPath constraints", (): void => {
  const invalidSubPaths: string[] = ["/absolute", "has:colon", "path/../parent", "has/\0null"];
  for (const subPath of invalidSubPaths) {
    const res: InvalidDomainParams | null = validateDeploymentVolumes([{ name: "data", mountPath: "/var/data", sizeGb: 32, subPath }]);
    assert.ok(res instanceof InvalidDomainParams, `Expected failure for subPath: ${subPath}`);
    assert.match(res.message, /Volume subPath must be a relative path/);
  }
});

test("validateDeploymentVolumes checks sizeGb and accessMode constraints", (): void => {
  const invalidSizes: number[] = [0, -1, 1.5, NaN, 31, 262145];
  for (const sizeGb of invalidSizes) {
    const res: InvalidDomainParams | null = validateDeploymentVolumes([{ name: "data", mountPath: "/var/data", sizeGb }]);
    assert.ok(res instanceof InvalidDomainParams, `Expected failure for sizeGb: ${sizeGb}`);
    assert.match(res.message, /Volume sizeGb/);
  }

  const resAccessMode: InvalidDomainParams | null = validateDeploymentVolumes([
    { name: "data", mountPath: "/var/data", sizeGb: 32, accessMode: "Invalid" as unknown as "ReadWrite" },
  ]);
  assert.ok(resAccessMode instanceof InvalidDomainParams);
  assert.match(resAccessMode.message, /Volume accessMode/);
});

test("validateDeploymentVolumes checks duplicates and quota limits", (): void => {
  const duplicates: readonly DeploymentVolume[] = [
    { name: "data", mountPath: "/var/data1", sizeGb: 32 },
    { name: "data", mountPath: "/var/data2", sizeGb: 32 },
  ];
  const resDupName: InvalidDomainParams | null = validateDeploymentVolumes(duplicates);
  assert.ok(resDupName instanceof InvalidDomainParams);
  assert.match(resDupName.message, /Duplicate volume name/);

  const duplicatePaths: readonly DeploymentVolume[] = [
    { name: "data1", mountPath: "/var/data", sizeGb: 32 },
    { name: "data2", mountPath: "/var/data/", sizeGb: 32 },
  ];
  const resDupPath: InvalidDomainParams | null = validateDeploymentVolumes(duplicatePaths);
  assert.ok(resDupPath instanceof InvalidDomainParams);
  assert.match(resDupPath.message, /Duplicate volume mountPath/);

  const resQuota: InvalidDomainParams | null = validateDeploymentVolumes([
    { name: "data1", mountPath: "/var/data1", sizeGb: 32 },
    { name: "data2", mountPath: "/var/data2", sizeGb: 32 },
  ], 50);
  assert.ok(resQuota instanceof InvalidDomainParams);
  assert.match(resQuota.message, /exceeds disk quota/);
});

test("Deployment domain model validates volumes in spec", (): void => {
  const validDeployment: Deployment = new Deployment({
    ...BASE_DETAILS,
    spec: {
      ...BASE_SPEC,
      volumes: [{ name: "my-vol", mountPath: "/mnt/storage", sizeGb: 32 }],
    },
  });
  assert.equal(validDeployment.spec?.volumes?.length, 1);
  assert.equal(validDeployment.spec?.volumes?.[0]?.name, "my-vol");

  assert.throws((): Deployment => {
    return new Deployment({
      ...BASE_DETAILS,
      spec: {
        ...BASE_SPEC,
        volumes: [{ name: "bad_name", mountPath: "/mnt/storage", sizeGb: 32 }],
      },
    });
  }, (error: unknown): boolean => error instanceof InvalidDomainParams && /Volume name/.test(error.message));
});
