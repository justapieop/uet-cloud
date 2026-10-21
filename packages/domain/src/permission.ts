export interface PermissionDefinition {
  readonly offset: number;
  readonly name: string;
  readonly description: string;
  readonly requires: readonly PermissionDefinition[];
}

export const Super: PermissionDefinition = {
  offset: 0,
  name: "Super",
  description: "Has all permissions. Granting this permission is not recommended.",
  requires: [],
};

export const DeploymentRead: PermissionDefinition = {
  offset: 1,
  name: "Read deployments",
  description: "List and read the user's own deployments and provisioning status.",
  requires: [],
};

export const DeploymentCreate: PermissionDefinition = {
  offset: 2,
  name: "Create deployments",
  description: "Queue a deployment and its source build, subject to subscription and plan quotas.",
  requires: [],
};

export const DeploymentUpdate: PermissionDefinition = {
  offset: 3,
  name: "Update deployments",
  description: "Update the user's own deployments.",
  requires: [DeploymentRead],
};

export const DeploymentDelete: PermissionDefinition = {
  offset: 4,
  name: "Delete deployments",
  description: "Delete the user's own deployments and their deployed resources.",
  requires: [DeploymentRead],
};

export const BuildRead: PermissionDefinition = {
  offset: 5,
  name: "Read builds",
  description: "Read the user's own build status, image, and pipeline details.",
  requires: [],
};

export const DeploymentMetricsRead: PermissionDefinition = {
  offset: 6,
  name: "Read deployment metrics",
  description: "Read usage metrics for the user's own deployments.",
  requires: [DeploymentRead],
};

export const Permission: Readonly<Record<
  "Super" | "DeploymentRead" | "DeploymentCreate" | "DeploymentUpdate" |
  "DeploymentDelete" | "BuildRead" | "DeploymentMetricsRead",
  PermissionDefinition
>> = {
  Super,
  DeploymentRead,
  DeploymentCreate,
  DeploymentUpdate,
  DeploymentDelete,
  BuildRead,
  DeploymentMetricsRead,
};

export type Permission = PermissionDefinition;
