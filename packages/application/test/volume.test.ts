import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment, InvalidDomainParams, Plan, User, type DeploymentDetails, type DeploymentVolume } from "@kumo/domain";
import {
  AttachVolumeCase,
  DetachVolumeCase,
  ListVolumesCase,
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

  const uow: UnitOfWork = {
    run: async <T>(operation: (repos: UnitOfWorkRepositories) => Promise<T>): Promise<T> => {
      const repos: UnitOfWorkRepositories = {
        ...emptyRepositories(),
        users: { ...emptyRepositories().users, findByIdForUpdate: async (): Promise<User | null> => createTestUser() },
        deployment: {
          ...emptyRepositories().deployment,
          findByIdAndUserId: async (): Promise<Deployment | null> => storedDeployment,
          save: async (dep: Deployment): Promise<void> => {
            storedDeployment = dep;
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
