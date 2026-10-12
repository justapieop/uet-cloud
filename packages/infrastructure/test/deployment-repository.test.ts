import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment } from "@kumo/domain";
import type { EntityManager, Repository } from "typeorm";
import {
  InfraDeployment,
  InfraDeploymentRepository,
  InfraDeploymentSpec,
} from "../dist/db/index.js";

test("InfraDeploymentRepository saves deployment and spec into separate tables within a transaction", async (): Promise<void> => {
  const deploymentSaved: InfraDeployment[] = [];
  const specSaved: InfraDeploymentSpec[] = [];

  const mockDeploymentRepo: Repository<InfraDeployment> = {
    create: (props: unknown): unknown => props,
    save: async (entity: unknown): Promise<unknown> => {
      deploymentSaved.push(entity as InfraDeployment);
      return entity;
    },
    findOne: async (): Promise<null> => null,
  } as unknown as Repository<InfraDeployment>;

  const mockSpecRepo: Repository<InfraDeploymentSpec> = {
    create: (props: unknown): unknown => props,
    findOneBy: async (): Promise<null> => null,
    save: async (entity: unknown): Promise<unknown> => {
      specSaved.push(entity as InfraDeploymentSpec);
      return entity;
    },
  } as unknown as Repository<InfraDeploymentSpec>;

  const mockManager: EntityManager = {
    getRepository: (entityClass: unknown): unknown => {
      if (entityClass === InfraDeployment) {
        return mockDeploymentRepo;
      }
      if (entityClass === InfraDeploymentSpec) {
        return mockSpecRepo;
      }
      throw new Error("Unknown entity class");
    },
  } as unknown as EntityManager;

  const mockMainDeploymentRepo: Repository<InfraDeployment> = {
    manager: {
      transaction: async <T>(
        work: (manager: EntityManager) => Promise<T>,
      ): Promise<T> => work(mockManager),
    },
  } as unknown as Repository<InfraDeployment>;

  const repo: InfraDeploymentRepository = new InfraDeploymentRepository(
    mockMainDeploymentRepo,
    mockSpecRepo,
  );

  const deployment: Deployment = new Deployment({
    id: "dep-1",
    userId: "user-1",
    name: "web-app",
    status: "RUNNING",
    spec: {
      image: "nginx:alpine",
      targetPort: 80,
      resources: { cpu: 0.5, memory: 1.0 },
      scaling: { minReplicas: 1, maxReplicas: 3 },
      envVars: { NODE_ENV: "production" },
    },
    fqdn: "web-app.eastasia.azurecontainerapps.io",
  });

  await repo.save(deployment);

  assert.equal(deploymentSaved.length, 1);
  assert.equal(deploymentSaved[0].id, "dep-1");
  assert.equal(deploymentSaved[0].userId, "user-1");
  assert.equal(deploymentSaved[0].name, "web-app");
  assert.equal(deploymentSaved[0].status, "RUNNING");
  assert.equal(deploymentSaved[0].fqdn, "web-app.eastasia.azurecontainerapps.io");

  assert.equal(specSaved.length, 1);
  assert.equal(specSaved[0].deploymentId, "dep-1");
  assert.equal(specSaved[0].image, "nginx:alpine");
  assert.equal(specSaved[0].targetPort, 80);
  assert.equal(specSaved[0].cpu, 0.5);
  assert.equal(specSaved[0].memory, 1.0);
  assert.equal(specSaved[0].minReplicas, 1);
  assert.equal(specSaved[0].maxReplicas, 3);
  assert.deepEqual(specSaved[0].envVars, { NODE_ENV: "production" });
});

test("InfraDeploymentRepository findById maps deployment and related spec to domain Deployment", async (): Promise<void> => {
  const dbSpec: InfraDeploymentSpec = {
    id: "spec-1",
    deploymentId: "dep-1",
    image: "mcr.microsoft.com/k8se/quickstart:latest",
    targetPort: 8080,
    cpu: 0.25,
    memory: 0.5,
    minReplicas: 0,
    maxReplicas: 2,
    envVars: { KEY: "VALUE" },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const dbDeployment: InfraDeployment = {
    id: "dep-1",
    userId: "user-42",
    name: "api-service",
    status: "RUNNING",
    fqdn: "api-service.eastasia.azurecontainerapps.io",
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    spec: dbSpec,
  };

  const mockDeploymentRepo: Repository<InfraDeployment> = {
    findOne: async (options: {
      where: { id: string; userId?: string };
      relations?: { spec: boolean };
    }): Promise<InfraDeployment | null> => {
      assert.equal(options.where.id, "dep-1");
      assert.equal(options.relations?.spec, true);
      return dbDeployment;
    },
  } as unknown as Repository<InfraDeployment>;

  const mockSpecRepo: Repository<InfraDeploymentSpec> = {} as Repository<InfraDeploymentSpec>;

  const repo: InfraDeploymentRepository = new InfraDeploymentRepository(
    mockDeploymentRepo,
    mockSpecRepo,
  );

  const found: Deployment | null = await repo.findById("dep-1");
  assert.ok(found);
  assert.equal(found.id, "dep-1");
  assert.equal(found.userId, "user-42");
  assert.equal(found.name, "api-service");
  assert.equal(found.status, "RUNNING");
  assert.equal(found.spec.image, "mcr.microsoft.com/k8se/quickstart:latest");
  assert.equal(found.spec.targetPort, 8080);
  assert.equal(found.spec.resources?.cpu, 0.25);
  assert.equal(found.spec.resources?.memory, 0.5);
  assert.equal(found.spec.scaling?.minReplicas, 0);
  assert.equal(found.spec.scaling?.maxReplicas, 2);
  assert.deepEqual(found.spec.envVars, { KEY: "VALUE" });
});
