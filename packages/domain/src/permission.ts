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
  name: "Read own deployments. Other users' deployments are not readable.",
  description: "",
  requires: [],
};

export const Permission: Readonly<Record<"Super" | "DeploymentRead", PermissionDefinition>> = {
  Super,
  DeploymentRead,
};

export type Permission = PermissionDefinition;
