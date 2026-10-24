import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment, type DeploymentSpec } from "@kumo/domain";
import { DeploymentConfigurationReadError, type DeploymentConfiguration, type DeploymentConfigurationReader } from "../dist/ports/deployment-configuration.js";
import { DeploymentNotFoundError, type DeploymentListFilters } from "../dist/ports/deployment.js";
import { GetDeploymentCase } from "../dist/use-cases/deployment/GetDeployment.case.js";
import { emptyRepositories } from "./support/repositories.ts";

const SPEC: DeploymentSpec = { repo: "https://github.com/owner/repo", region: "eastus", targetPort: 80, maxVcpu: 0.5, maxMemory: 1, minScaling: 0, maxScaling: 1 };
const APPLIED: DeploymentConfiguration = { region: "japaneast", maxVcpu: 2, maxMemory: 4, minScaling: 1, maxScaling: 5, targetPort: 8080, external: true, additionalPorts: [], image: "registry/app:v2", fqdn: "live.example.com" };

test("deployment reads preserve saved intent and resolve applied configuration only after ownership lookup", async (): Promise<void> => {
  let calls: number = 0;
  const deployment: Deployment = new Deployment({ id: "deployment", userId: "123", name: "my-app", status: "RUNNING", spec: SPEC, resourceId: "resource" });
  const reader: DeploymentConfigurationReader = { read: async (input): Promise<DeploymentConfiguration> => {
    calls++; assert.equal(input.userId, "123"); assert.equal(input.resourceId, "resource"); return APPLIED;
  } };
  const useCase: GetDeploymentCase = new GetDeploymentCase({ ...emptyRepositories().deployment,
    findByIdAndUserId: async (_id: string, userId: string): Promise<Deployment | null> => userId === "123" ? deployment : null,
  }, reader);
  await assert.rejects(useCase.exec("deployment", "456"), DeploymentNotFoundError);
  assert.equal(calls, 0);
  const result: Awaited<ReturnType<GetDeploymentCase["exec"]>> = await useCase.exec("deployment", "123");
  assert.equal(result.configuration, APPLIED);
  assert.equal(result.deployment.spec?.maxVcpu, 0.5);
  assert.equal(result.deployment.spec?.region, "eastus");
});

test("queued, failed-before-provisioning and deleted records need no Azure reads; malformed running rows fail closed", async (): Promise<void> => {
  const reader: DeploymentConfigurationReader = { read: async (): Promise<never> => { throw new Error("Must not read Azure"); } };
  for (const status of ["PENDING", "PROVISIONING", "FAILED", "DELETED"] as const) {
    const deployment: Deployment = new Deployment({ id: "deployment", userId: "123", name: "my-app", status, spec: SPEC });
    const useCase: GetDeploymentCase = new GetDeploymentCase({ ...emptyRepositories().deployment, findByIdAndUserId: async (): Promise<Deployment> => deployment }, reader);
    assert.equal((await useCase.exec(deployment.id, "123")).configuration, null);
  }
  const invalid: GetDeploymentCase = new GetDeploymentCase({ ...emptyRepositories().deployment,
    findByIdAndUserId: async (): Promise<Deployment> => new Deployment({ id: "deployment", userId: "123", name: "my-app", status: "RUNNING" }),
  }, reader);
  await assert.rejects(invalid.exec("deployment", "123"), DeploymentConfigurationReadError);
});

test("list region filtering uses applied Azure regions and bounds parallel reads", async (): Promise<void> => {
  let active: number = 0;
  let maximum: number = 0;
  const useCase: GetDeploymentCase = new GetDeploymentCase({ ...emptyRepositories().deployment,
    findByUserId: async (userId: string, filters?: DeploymentListFilters): Promise<Deployment[]> => {
      assert.equal(userId, "123"); assert.equal(filters?.region, undefined); assert.equal(filters?.name, "my-app");
      return Array.from({ length: 9 }, (_value: unknown, index: number): Deployment => new Deployment({ id: String(index), userId, name: "my-app", status: "RUNNING", resourceId: "resource", spec: SPEC }));
    },
  }, { read: async (): Promise<DeploymentConfiguration> => {
    active++; maximum = Math.max(maximum, active);
    await new Promise<void>((resolve: () => void): void => { setImmediate(resolve); });
    active--; return APPLIED;
  } });
  assert.equal((await useCase.list("123", { name: "my-app", region: "japaneast" })).length, 9);
  assert.equal(maximum, 4);
  assert.equal((await useCase.list("123", { name: "my-app", region: "eastus" })).length, 0);
});
