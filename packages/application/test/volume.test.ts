import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment, InvalidDomainParams, Plan, User, Volume, type DeploymentDetails, type DeploymentVolume } from "@kumo/domain";
import {
  AttachVolumeCase,
  DetachVolumeCase,
  ListVolumesCase,
  CreateVolumeCase,
  DeleteVolumeCase,
  ListUserVolumesCase,
  VolumeAlreadyExists,
  VolumeInUseError,
  VolumeNotFoundError,
  DeploymentNotFoundError,
  InvalidDeploymentStatusError,
  DeploymentQuotaExceeded,
  DeploymentSubscriptionRequired,
  type StripeSubscriptionGateway,
  type UnitOfWork,
  type UnitOfWorkRepositories,
  type VolumeManager,
} from "../dist/index.js";
import { emptyRepositories } from "./support/repositories.ts";

function createTestDeployment(overrides: Partial<DeploymentDetails> = {}): Deployment {
  const details: DeploymentDetails = {
    id: "dep-1",
    userId: "user-1",
    name: "my-app",
    status: "RUNNING",
    resourceId: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/containerApps/my-app",
    spec: {
      repo: "https://github.com/owner/repo",
      targetPort: 8080,
      maxVcpu: 0.5,
      maxMemory: 1,
      minScaling: 0,
      maxScaling: 2,
      volumes: [],
    },
    ...overrides,
  };
  return new Deployment(details);
}

function createTestUser(overrides: { suspended?: boolean; stripeCustomerId?: string | null } = {}): User {
  return new User({
    id: "user-1",
    displayName: "User One",
    active: true,
    suspended: overrides.suspended ?? false,
    stripeCustomerId: overrides.stripeCustomerId !== undefined ? overrides.stripeCustomerId : "cus_123",
  });
}

const TEST_PLAN: Plan = new Plan({
  id: "plan-1",
  name: "Developer Plan",
  price: 10,
  vcpu: 1,
  memory: 2,
  deployments: 5,
  disk: 10,
  stripeProductId: "prod_123",
});

test("AttachVolumeCase attaches volume to a running deployment within quota", async (): Promise<void> => {
  let storedDeployment: Deployment = createTestDeployment();
  const attachedCalls: { volume: DeploymentVolume }[] = [];

  const uow: UnitOfWork = {
    run: async <T>(operation: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> => {
      const repos: UnitOfWorkRepositories = {
        ...emptyRepositories(),
        users: {
          ...emptyRepositories().users,
          findById: async (): Promise<User | null> => createTestUser(),
          findByIdForUpdate: async (): Promise<User | null> => createTestUser(),
        },
        deployment: {
          ...emptyRepositories().deployment,
          findByIdAndUserId: async (): Promise<Deployment | null> => storedDeployment,
          save: async (dep: Deployment): Promise<void> => {
            storedDeployment = dep;
          },
        },
        plans: {
          ...emptyRepositories().plans,
          findActiveByStripeProductIds: async (): Promise<Plan[]> => [TEST_PLAN],
        },
        volumes: {
          ...emptyRepositories().volumes,
          findByNameAndUserId: async (): Promise<Volume | null> => null,
          save: async (): Promise<void> => {},
        },
      };
      return operation(repos);
    },
  };

  const subscriptions: StripeSubscriptionGateway = {
    getActiveSubscriptionProductIds: async (): Promise<readonly string[]> => ["prod_123"],
  };

  const volumeManager: VolumeManager = {
    attachVolume: async (input): Promise<void> => {
      attachedCalls.push({ volume: input.volume });
    },
    detachVolume: async (): Promise<void> => {},
  };

  const useCase: AttachVolumeCase = new AttachVolumeCase(uow, subscriptions, volumeManager);
  const volumeToAttach: DeploymentVolume = {
    name: "data",
    mountPath: "/var/data",
    sizeGb: 5,
    accessMode: "ReadWrite",
  };

  const updated: Deployment = await useCase.exec({
    userId: "user-1",
    deploymentId: "dep-1",
    volume: volumeToAttach,
  });

  assert.equal(updated.spec?.volumes?.length, 1);
  assert.equal(updated.spec?.volumes?.[0]?.name, "data");
  assert.equal(attachedCalls.length, 1);
  assert.equal(attachedCalls[0]?.volume.name, "data");
});

test("AttachVolumeCase rejects attaching when deployment status is invalid", async (): Promise<void> => {
  const invalidStatuses: ("PENDING" | "PROVISIONING" | "STARTING" | "STOPPING" | "FAILED")[] = [
    "PENDING",
    "PROVISIONING",
    "STARTING",
    "STOPPING",
    "FAILED",
  ];

  for (const status of invalidStatuses) {
    const deployment: Deployment = createTestDeployment({ status });
    const uow: UnitOfWork = {
      run: async <T>(operation: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> => {
        const repos: UnitOfWorkRepositories = {
          ...emptyRepositories(),
          users: { ...emptyRepositories().users, findById: async (): Promise<User | null> => createTestUser() },
          deployment: { ...emptyRepositories().deployment, findByIdAndUserId: async (): Promise<Deployment | null> => deployment },
        };
        return operation(repos);
      },
    };
    const subscriptions: StripeSubscriptionGateway = { getActiveSubscriptionProductIds: async (): Promise<readonly string[]> => ["prod_123"] };
    const volumeManager: VolumeManager = { attachVolume: async (): Promise<void> => {}, detachVolume: async (): Promise<void> => {} };

    const useCase: AttachVolumeCase = new AttachVolumeCase(uow, subscriptions, volumeManager);
    await assert.rejects(
      useCase.exec({
        userId: "user-1",
        deploymentId: "dep-1",
        volume: { name: "data", mountPath: "/var/data", sizeGb: 2 },
      }),
      (err: unknown): boolean => err instanceof InvalidDeploymentStatusError,
    );
  }
});

test("AttachVolumeCase rejects when volume exceeds plan disk quota", async (): Promise<void> => {
  const storedDeployment: Deployment = createTestDeployment({
    spec: {
      repo: "https://github.com/owner/repo",
      targetPort: 8080,
      maxVcpu: 0.5,
      maxMemory: 1,
      minScaling: 0,
      maxScaling: 2,
      volumes: [{ name: "existing", mountPath: "/mnt/existing", sizeGb: 8 }],
    },
  });

  const uow: UnitOfWork = {
    run: async <T>(operation: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> => {
      const repos: UnitOfWorkRepositories = {
        ...emptyRepositories(),
        users: {
          ...emptyRepositories().users,
          findById: async (): Promise<User | null> => createTestUser(),
          findByIdForUpdate: async (): Promise<User | null> => createTestUser(),
        },
        deployment: {
          ...emptyRepositories().deployment,
          findByIdAndUserId: async (): Promise<Deployment | null> => storedDeployment,
        },
        plans: {
          ...emptyRepositories().plans,
          findActiveByStripeProductIds: async (): Promise<Plan[]> => [TEST_PLAN],
        },
        volumes: {
          ...emptyRepositories().volumes,
          findByNameAndUserId: async (): Promise<Volume | null> => null,
          save: async (): Promise<void> => {},
        },
      };
      return operation(repos);
    },
  };

  const subscriptions: StripeSubscriptionGateway = {
    getActiveSubscriptionProductIds: async (): Promise<readonly string[]> => ["prod_123"],
  };
  const volumeManager: VolumeManager = { attachVolume: async (): Promise<void> => {}, detachVolume: async (): Promise<void> => {} };

  const useCase: AttachVolumeCase = new AttachVolumeCase(uow, subscriptions, volumeManager);
  await assert.rejects(
    useCase.exec({
      userId: "user-1",
      deploymentId: "dep-1",
      volume: { name: "data2", mountPath: "/mnt/data2", sizeGb: 5 }, // 8 + 5 = 13 > 10
    }),
    (err: unknown): boolean => err instanceof DeploymentQuotaExceeded,
  );
});

test("DetachVolumeCase detaches volume from deployment", async (): Promise<void> => {
  let storedDeployment: Deployment = createTestDeployment({
    spec: {
      repo: "https://github.com/owner/repo",
      targetPort: 8080,
      maxVcpu: 0.5,
      maxMemory: 1,
      minScaling: 0,
      maxScaling: 2,
      volumes: [
        { name: "data", mountPath: "/var/data", sizeGb: 2 },
        { name: "logs", mountPath: "/var/logs", sizeGb: 3 },
      ],
    },
  });

  const detachedCalls: { volumeName: string; deleteData?: boolean }[] = [];
  const deletedVolumeIds: string[] = [];

  const testVolume: Volume = new Volume({
    id: "vol-data-id",
    userId: "user-1",
    name: "data",
    sizeGb: 2,
    region: "eastasia",
  });

  const uow: UnitOfWork = {
    run: async <T>(operation: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> => {
      const repos: UnitOfWorkRepositories = {
        ...emptyRepositories(),
        users: { ...emptyRepositories().users, findByIdForUpdate: async (): Promise<User | null> => createTestUser() },
        deployment: {
          ...emptyRepositories().deployment,
          findByIdAndUserId: async (): Promise<Deployment | null> => storedDeployment,
          findByUserId: async (): Promise<Deployment[]> => [storedDeployment],
          save: async (dep: Deployment): Promise<void> => {
            storedDeployment = dep;
          },
        },
        volumes: {
          ...emptyRepositories().volumes,
          findByNameAndUserId: async (name: string): Promise<Volume | null> => (name === "data" ? testVolume : null),
          delete: async (id: string): Promise<void> => {
            deletedVolumeIds.push(id);
          },
        },
      };
      return operation(repos);
    },
  };

  const volumeManager: VolumeManager = {
    attachVolume: async (): Promise<void> => {},
    detachVolume: async (input): Promise<void> => {
      detachedCalls.push({ volumeName: input.volumeName, deleteData: input.deleteData });
    },
  };

  const useCase: DetachVolumeCase = new DetachVolumeCase(uow, volumeManager);
  const updated: Deployment = await useCase.exec({
    userId: "user-1",
    deploymentId: "dep-1",
    volumeName: "data",
    deleteData: true,
  });

  assert.equal(updated.spec?.volumes?.length, 1);
  assert.equal(updated.spec?.volumes?.[0]?.name, "logs");
  assert.deepEqual(detachedCalls, [{ volumeName: "data", deleteData: true }]);
  assert.deepEqual(deletedVolumeIds, ["vol-data-id"]);
});

test("DetachVolumeCase throws VolumeInUseError when deleteData=true and volume is in use by another deployment", async (): Promise<void> => {
  const currentDeployment: Deployment = createTestDeployment({
    id: "dep-1",
    name: "app-1",
    spec: {
      repo: "https://github.com/owner/repo",
      targetPort: 8080,
      maxVcpu: 0.5,
      maxMemory: 1,
      minScaling: 0,
      maxScaling: 2,
      volumes: [{ name: "shared-data", mountPath: "/data", sizeGb: 5 }],
    },
  });

  const otherDeployment: Deployment = createTestDeployment({
    id: "dep-2",
    name: "app-2",
    spec: {
      repo: "https://github.com/owner/repo2",
      targetPort: 8080,
      maxVcpu: 0.5,
      maxMemory: 1,
      minScaling: 0,
      maxScaling: 2,
      volumes: [{ name: "shared-data", mountPath: "/data", sizeGb: 5 }],
    },
  });

  const uow: UnitOfWork = {
    run: async <T>(operation: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> => {
      const repos: UnitOfWorkRepositories = {
        ...emptyRepositories(),
        users: { ...emptyRepositories().users, findByIdForUpdate: async (): Promise<User | null> => createTestUser() },
        deployment: {
          ...emptyRepositories().deployment,
          findByIdAndUserId: async (): Promise<Deployment | null> => currentDeployment,
          findByUserId: async (): Promise<Deployment[]> => [currentDeployment, otherDeployment],
        },
      };
      return operation(repos);
    },
  };

  const volumeManager: VolumeManager = {
    attachVolume: async (): Promise<void> => {},
    detachVolume: async (): Promise<void> => {},
  };

  const useCase: DetachVolumeCase = new DetachVolumeCase(uow, volumeManager);
  await assert.rejects(
    async (): Promise<Deployment> =>
      useCase.exec({
        userId: "user-1",
        deploymentId: "dep-1",
        volumeName: "shared-data",
        deleteData: true,
      }),
    (err: unknown): boolean => err instanceof VolumeInUseError,
  );
});

test("DetachVolumeCase throws when volume does not exist or deployment status is invalid", async (): Promise<void> => {
  const storedDeployment: Deployment = createTestDeployment();
  const uow: UnitOfWork = {
    run: async <T>(operation: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> => {
      const repos: UnitOfWorkRepositories = {
        ...emptyRepositories(),
        users: { ...emptyRepositories().users, findByIdForUpdate: async (): Promise<User | null> => createTestUser() },
        deployment: { ...emptyRepositories().deployment, findByIdAndUserId: async (): Promise<Deployment | null> => storedDeployment },
      };
      return operation(repos);
    },
  };
  const volumeManager: VolumeManager = { attachVolume: async (): Promise<void> => {}, detachVolume: async (): Promise<void> => {} };
  const useCase: DetachVolumeCase = new DetachVolumeCase(uow, volumeManager);

  await assert.rejects(
    useCase.exec({ userId: "user-1", deploymentId: "dep-1", volumeName: "non-existent" }),
    (err: unknown): boolean => err instanceof InvalidDomainParams && /not found on deployment/.test(err.message),
  );
});

test("ListVolumesCase returns volume list for deployment", async (): Promise<void> => {
  const volumes: readonly DeploymentVolume[] = [{ name: "data", mountPath: "/var/data", sizeGb: 2 }];
  const storedDeployment: Deployment = createTestDeployment({
    spec: {
      repo: "https://github.com/owner/repo",
      targetPort: 8080,
      maxVcpu: 0.5,
      maxMemory: 1,
      minScaling: 0,
      maxScaling: 2,
      volumes,
    },
  });

  const uow: UnitOfWork = {
    run: async <T>(operation: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> => {
      const repos: UnitOfWorkRepositories = {
        ...emptyRepositories(),
        users: { ...emptyRepositories().users, findById: async (): Promise<User | null> => createTestUser() },
        deployment: { ...emptyRepositories().deployment, findByIdAndUserId: async (): Promise<Deployment | null> => storedDeployment },
      };
      return operation(repos);
    },
  };

  const useCase: ListVolumesCase = new ListVolumesCase(uow);
  const result: readonly DeploymentVolume[] = await useCase.exec({ userId: "user-1", deploymentId: "dep-1" });
  assert.deepEqual(result, volumes);
});

test("CreateVolumeCase creates standalone volume within disk quota and calls volumeManager", async (): Promise<void> => {
  let savedVolume: Volume | null = null;
  const storageCreated: { volumeName: string; sizeGb: number }[] = [];

  const uow: UnitOfWork = {
    run: async <T>(operation: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> => {
      const repos: UnitOfWorkRepositories = {
        ...emptyRepositories(),
        users: {
          ...emptyRepositories().users,
          findById: async (): Promise<User | null> => createTestUser(),
          findByIdForUpdate: async (): Promise<User | null> => createTestUser(),
        },
        volumes: {
          ...emptyRepositories().volumes,
          findByNameAndUserId: async (): Promise<Volume | null> => null,
          findByUserId: async (): Promise<Volume[]> => [],
          save: async (vol: Volume): Promise<void> => {
            savedVolume = vol;
          },
        },
        plans: {
          ...emptyRepositories().plans,
          findActiveByStripeProductIds: async (): Promise<Plan[]> => [TEST_PLAN],
        },
      };
      return operation(repos);
    },
  };

  const subscriptions: StripeSubscriptionGateway = {
    getActiveSubscriptionProductIds: async (): Promise<readonly string[]> => ["prod_123"],
  };

  const volumeManager: VolumeManager = {
    attachVolume: async (): Promise<void> => {},
    detachVolume: async (): Promise<void> => {},
    createStorageVolume: async (input): Promise<void> => {
      storageCreated.push({ volumeName: input.volumeName, sizeGb: input.sizeGb });
    },
  };

  const useCase: CreateVolumeCase = new CreateVolumeCase(uow, subscriptions, volumeManager);
  const created: Volume = await useCase.exec({
    userId: "user-1",
    name: "shared-data",
    sizeGb: 5,
    region: "eastus2",
  });

  assert.equal(created.name, "shared-data");
  assert.equal(created.sizeGb, 5);
  assert.equal(created.region, "eastus2");
  assert.ok(savedVolume !== null);
  assert.equal((savedVolume as Volume).name, "shared-data");
  assert.deepEqual(storageCreated, [{ volumeName: "shared-data", sizeGb: 5 }]);
});

test("CreateVolumeCase rejects when volume name already exists or quota exceeded", async (): Promise<void> => {
  const existingVolume: Volume = new Volume({
    id: "vol-1",
    userId: "user-1",
    name: "existing-data",
    sizeGb: 8,
    region: "eastus2",
  });

  const uowDuplicate: UnitOfWork = {
    run: async <T>(operation: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> => {
      const repos: UnitOfWorkRepositories = {
        ...emptyRepositories(),
        users: { ...emptyRepositories().users, findById: async (): Promise<User | null> => createTestUser() },
        volumes: {
          ...emptyRepositories().volumes,
          findByNameAndUserId: async (): Promise<Volume | null> => existingVolume,
        },
      };
      return operation(repos);
    },
  };

  const subscriptions: StripeSubscriptionGateway = {
    getActiveSubscriptionProductIds: async (): Promise<readonly string[]> => ["prod_123"],
  };
  const volumeManager: VolumeManager = { attachVolume: async (): Promise<void> => {}, detachVolume: async (): Promise<void> => {} };

  const useCaseDuplicate: CreateVolumeCase = new CreateVolumeCase(uowDuplicate, subscriptions, volumeManager);
  await assert.rejects(
    useCaseDuplicate.exec({ userId: "user-1", name: "existing-data", sizeGb: 2, region: "eastus2" }),
    (err: unknown): boolean => err instanceof VolumeAlreadyExists,
  );

  const uowQuota: UnitOfWork = {
    run: async <T>(operation: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> => {
      const repos: UnitOfWorkRepositories = {
        ...emptyRepositories(),
        users: {
          ...emptyRepositories().users,
          findById: async (): Promise<User | null> => createTestUser(),
          findByIdForUpdate: async (): Promise<User | null> => createTestUser(),
        },
        volumes: {
          ...emptyRepositories().volumes,
          findByNameAndUserId: async (): Promise<Volume | null> => null,
          findByUserId: async (): Promise<Volume[]> => [existingVolume], // 8 GiB used out of 10
        },
        plans: { ...emptyRepositories().plans, findActiveByStripeProductIds: async (): Promise<Plan[]> => [TEST_PLAN] },
      };
      return operation(repos);
    },
  };

  const useCaseQuota: CreateVolumeCase = new CreateVolumeCase(uowQuota, subscriptions, volumeManager);
  await assert.rejects(
    useCaseQuota.exec({ userId: "user-1", name: "another-vol", sizeGb: 5, region: "eastus2" }), // 8 + 5 = 13 > 10
    (err: unknown): boolean => err instanceof DeploymentQuotaExceeded,
  );
});

test("ListUserVolumesCase returns user volumes with attached deployment references", async (): Promise<void> => {
  const volA: Volume = new Volume({ id: "v1", userId: "user-1", name: "vol-a", sizeGb: 5, region: "eastus2" });
  const volB: Volume = new Volume({ id: "v2", userId: "user-1", name: "vol-b", sizeGb: 2, region: "eastus2" });

  const dep1: Deployment = createTestDeployment({
    id: "d1",
    name: "frontend",
    spec: {
      repo: "https://github.com/owner/repo",
      targetPort: 80,
      maxVcpu: 0.5,
      maxMemory: 1,
      minScaling: 0,
      maxScaling: 1,
      volumes: [{ name: "vol-a", mountPath: "/mnt/data", sizeGb: 5 }],
    },
  });

  const dep2: Deployment = createTestDeployment({
    id: "d2",
    name: "backend",
    spec: {
      repo: "https://github.com/owner/repo",
      targetPort: 8080,
      maxVcpu: 0.5,
      maxMemory: 1,
      minScaling: 0,
      maxScaling: 1,
      volumes: [{ name: "vol-a", mountPath: "/mnt/shared", sizeGb: 5 }],
    },
  });

  const uow: UnitOfWork = {
    run: async <T>(operation: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> => {
      const repos: UnitOfWorkRepositories = {
        ...emptyRepositories(),
        users: { ...emptyRepositories().users, findById: async (): Promise<User | null> => createTestUser() },
        volumes: { ...emptyRepositories().volumes, findByUserId: async (): Promise<Volume[]> => [volA, volB] },
        deployment: { ...emptyRepositories().deployment, findByUserId: async (): Promise<Deployment[]> => [dep1, dep2] },
      };
      return operation(repos);
    },
  };

  const useCase: ListUserVolumesCase = new ListUserVolumesCase(uow);
  const items = await useCase.exec({ userId: "user-1" });

  assert.equal(items.length, 2);
  assert.equal(items[0]?.volume.name, "vol-a");
  assert.deepEqual(items[0]?.attachedDeployments, [
    { id: "d1", name: "frontend" },
    { id: "d2", name: "backend" },
  ]);
  assert.equal(items[1]?.volume.name, "vol-b");
  assert.deepEqual(items[1]?.attachedDeployments, []);
});

test("DeleteVolumeCase deletes unattached volume and calls volumeManager", async (): Promise<void> => {
  const vol: Volume = new Volume({ id: "v1", userId: "user-1", name: "unattached-vol", sizeGb: 5, region: "eastus2" });
  let deletedId: string | null = null;
  let deletedStorageName: string | null = null;

  const uow: UnitOfWork = {
    run: async <T>(operation: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> => {
      const repos: UnitOfWorkRepositories = {
        ...emptyRepositories(),
        users: { ...emptyRepositories().users, findById: async (): Promise<User | null> => createTestUser() },
        volumes: {
          ...emptyRepositories().volumes,
          findByNameAndUserId: async (): Promise<Volume | null> => vol,
          delete: async (id: string): Promise<void> => { deletedId = id; },
        },
        deployment: { ...emptyRepositories().deployment, findByUserId: async (): Promise<Deployment[]> => [] },
      };
      return operation(repos);
    },
  };

  const volumeManager: VolumeManager = {
    attachVolume: async (): Promise<void> => {},
    detachVolume: async (): Promise<void> => {},
    deleteStorageVolume: async (input): Promise<void> => { deletedStorageName = input.volumeName; },
  };

  const useCase: DeleteVolumeCase = new DeleteVolumeCase(uow, volumeManager);
  await useCase.exec({ userId: "user-1", volumeName: "unattached-vol" });

  assert.equal(deletedId as string | null, "v1");
  assert.equal(deletedStorageName as string | null, "unattached-vol");
});

test("DeleteVolumeCase throws VolumeInUseError when volume is attached to an active deployment", async (): Promise<void> => {
  const vol: Volume = new Volume({ id: "v1", userId: "user-1", name: "in-use-vol", sizeGb: 5, region: "eastus2" });
  const dep: Deployment = createTestDeployment({
    id: "d1",
    name: "active-app",
    status: "RUNNING",
    spec: {
      repo: "https://github.com/owner/repo",
      targetPort: 80,
      maxVcpu: 0.5,
      maxMemory: 1,
      minScaling: 0,
      maxScaling: 1,
      volumes: [{ name: "in-use-vol", mountPath: "/data", sizeGb: 5 }],
    },
  });

  const uow: UnitOfWork = {
    run: async <T>(operation: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> => {
      const repos: UnitOfWorkRepositories = {
        ...emptyRepositories(),
        users: { ...emptyRepositories().users, findById: async (): Promise<User | null> => createTestUser() },
        volumes: {
          ...emptyRepositories().volumes,
          findByNameAndUserId: async (): Promise<Volume | null> => vol,
        },
        deployment: { ...emptyRepositories().deployment, findByUserId: async (): Promise<Deployment[]> => [dep] },
      };
      return operation(repos);
    },
  };

  const volumeManager: VolumeManager = { attachVolume: async (): Promise<void> => {}, detachVolume: async (): Promise<void> => {} };
  const useCase: DeleteVolumeCase = new DeleteVolumeCase(uow, volumeManager);

  await assert.rejects(
    useCase.exec({ userId: "user-1", volumeName: "in-use-vol" }),
    (err: unknown): boolean => err instanceof VolumeInUseError && err.message.includes("active-app"),
  );
});
