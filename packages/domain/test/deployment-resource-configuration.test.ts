import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DeploymentResourceConfiguration, Domain, InvalidDomainParams,
  type DeploymentResourceConfigurationDetails,
} from "../dist/index.js";

const RESOURCES: DeploymentResourceConfigurationDetails = { maxVcpu: 1, maxMemory: 2, minScaling: 0, maxScaling: 3 };

test("resource configuration is a Domain and accepts valid per-replica allocations and scaling bounds", (): void => {
  const valid: readonly DeploymentResourceConfigurationDetails[] = [
    { maxVcpu: 0.25, maxMemory: 0.5, minScaling: 0, maxScaling: 1 },
    RESOURCES,
    { maxVcpu: 2, maxMemory: 4, minScaling: 5, maxScaling: 5 },
    { maxVcpu: 8, maxMemory: 16, minScaling: 0, maxScaling: 1001 },
  ];
  valid.forEach((details: DeploymentResourceConfigurationDetails): void => {
    const configuration: DeploymentResourceConfiguration = new DeploymentResourceConfiguration(details);
    assert.ok(configuration instanceof Domain);
    assert.equal(configuration.validate(), null);
    assert.deepEqual(configuration.getDetails(), details);
  });
});

test("resource configuration rejects each invalid compute rule against otherwise valid details", (): void => {
  const cases: readonly { patch: Partial<DeploymentResourceConfigurationDetails>; rule: RegExp }[] = [
    { patch: { maxVcpu: 0, maxMemory: 0 }, rule: /cpu|memory|resource/i },
    { patch: { maxVcpu: -0.25, maxMemory: -0.5 }, rule: /cpu|memory|resource/i },
    { patch: { maxVcpu: 0.3, maxMemory: 0.6 }, rule: /cpu|memory|resource/i },
    { patch: { maxVcpu: NaN }, rule: /cpu|memory|resource/i },
    { patch: { maxVcpu: Infinity, maxMemory: Infinity }, rule: /cpu|memory|resource/i },
    { patch: { maxVcpu: "1" as unknown as number }, rule: /cpu|memory|resource/i },
    { patch: { maxVcpu: undefined as unknown as number }, rule: /cpu|memory|resource/i },
    { patch: { maxMemory: 1 }, rule: /memory|resource/i },
    { patch: { maxMemory: NaN }, rule: /memory|resource/i },
    { patch: { maxMemory: Infinity }, rule: /memory|resource/i },
    { patch: { maxMemory: "2" as unknown as number }, rule: /memory|resource/i },
    { patch: { minScaling: -1 }, rule: /replica|scal/i },
    { patch: { minScaling: 0.5 }, rule: /replica|scal/i },
    { patch: { minScaling: NaN }, rule: /replica|scal/i },
    { patch: { maxScaling: 0 }, rule: /replica|scal/i },
    { patch: { maxScaling: 1.5 }, rule: /replica|scal/i },
    { patch: { maxScaling: Infinity }, rule: /replica|scal/i },
    { patch: { minScaling: 4 }, rule: /replica|scal/i },
  ];
  assert.doesNotThrow((): DeploymentResourceConfiguration => new DeploymentResourceConfiguration(RESOURCES));
  cases.forEach((item: { patch: Partial<DeploymentResourceConfigurationDetails>; rule: RegExp }): void => {
    assert.throws((): DeploymentResourceConfiguration => new DeploymentResourceConfiguration({ ...RESOURCES, ...item.patch }),
      (error: unknown): boolean => error instanceof InvalidDomainParams && item.rule.test(error.message));
  });
});

test("resource configuration keeps its value when constructor input is mutated", (): void => {
  const input: { maxVcpu: number; maxMemory: number; minScaling: number; maxScaling: number } = { ...RESOURCES };
  const configuration: DeploymentResourceConfiguration = new DeploymentResourceConfiguration(input);
  input.maxVcpu = 2;
  input.maxMemory = 4;
  input.maxScaling = 5;
  assert.deepEqual(configuration.getDetails(), RESOURCES);
});
