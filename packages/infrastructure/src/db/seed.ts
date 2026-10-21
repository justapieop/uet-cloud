import { Permission, Plan, Role, type PermissionDefinition, type PlanDetails } from "@kumo/domain";
import { type DataSource, type EntityManager } from "typeorm";
import { InfraPlan } from "./repositories/plan.js";
import { InfraRole } from "./repositories/role.js";
import { InfraUser } from "./repositories/user.js";
import { InfraUserRole } from "./repositories/user-role.js";
import { acquireBootstrapLock } from "./bootstrap-lock.js";

export interface SeedAssignment { readonly userId: string; readonly roleId: "viewer" | "developer" | "admin"; }
export interface DatabaseSeedInput { readonly plans?: readonly PlanDetails[]; readonly assignments?: readonly SeedAssignment[]; }
export interface DatabaseSeedResult { rolesCreated: number; plansCreated: number; assignmentsCreated: number; adminSuperAdded: boolean; }

function permissionBits(permissions: readonly PermissionDefinition[]): bigint {
  return permissions.reduce((bits: bigint, permission: PermissionDefinition): bigint => bits | (1n << BigInt(permission.offset)), 0n);
}

// Explicit grants prevent newly added catalog entries from silently expanding these roles.
export function defaultSeedRoles(): Role[] {
  const reads: PermissionDefinition[] = [Permission.DeploymentRead, Permission.BuildRead, Permission.DeploymentMetricsRead];
  return [
    new Role({ id: "viewer", name: "Viewer", permission: permissionBits(reads) }),
    new Role({ id: "developer", name: "Developer", permission: permissionBits([
      ...reads, Permission.DeploymentCreate, Permission.DeploymentUpdate, Permission.DeploymentDelete,
    ]) }),
    new Role({ id: "admin", name: "Administrator", permission: permissionBits([Permission.Super]) }),
  ];
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Seed data must contain JSON objects");
  const result: Record<string, unknown> = value as Record<string, unknown>;
  if (Object.keys(result).some((key: string): boolean => !keys.includes(key))) throw new Error("Unknown seed data field");
  return result;
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 255;
}

export function parseDatabaseSeedInput(value: unknown): DatabaseSeedInput {
  const input: Record<string, unknown> = record(value, ["plans", "assignments"]);
  if (input.plans !== undefined && !Array.isArray(input.plans)) throw new Error("Seed plans must be an array");
  if (input.assignments !== undefined && !Array.isArray(input.assignments)) throw new Error("Seed assignments must be an array");
  const plans: PlanDetails[] = (input.plans as unknown[] | undefined ?? []).map((item: unknown): PlanDetails => {
    const details: Record<string, unknown> = record(item, ["id", "name", "price", "vcpu", "memory", "deployments", "disk", "active", "stripeProductId", "maxReplicas"]);
    if (!identifier(details.id) || !identifier(details.name)) throw new Error("Plan ID and name must be nonblank strings of at most 255 characters");
    const plan: Plan = new Plan(details as unknown as PlanDetails);
    if (plan.price >= 1e15 || !/^\d+(?:\.\d{1,4})?$/.test(String(plan.price))) throw new Error("Plan price must fit decimal(19,4)");
    if ([plan.deployments, plan.disk, plan.maxReplicas].some((count: number): boolean => count > 2147483647)) throw new Error("Plan quotas exceed SQL int storage");
    return {
      id: plan.id, name: plan.name, price: plan.price, vcpu: plan.vcpu, memory: plan.memory,
      deployments: plan.deployments, disk: plan.disk, active: plan.active,
      stripeProductId: plan.stripeProductId, maxReplicas: plan.maxReplicas,
    };
  });
  const assignments: SeedAssignment[] = (input.assignments as unknown[] | undefined ?? []).map((item: unknown): SeedAssignment => {
    const assignment: Record<string, unknown> = record(item, ["userId", "roleId"]);
    if (!identifier(assignment.userId) || typeof assignment.roleId !== "string" || !["viewer", "developer", "admin"].includes(assignment.roleId)) throw new Error("Assignments require an existing user ID and a built-in role ID");
    return { userId: assignment.userId, roleId: assignment.roleId as SeedAssignment["roleId"] };
  });
  if (new Set(plans.map((plan: PlanDetails): string => plan.id.toLowerCase())).size !== plans.length) throw new Error("Duplicate seed plan IDs");
  const products: string[] = plans.flatMap((plan: PlanDetails): string[] => plan.stripeProductId ? [plan.stripeProductId] : []);
  if (new Set(products).size !== products.length) throw new Error("Duplicate seed Stripe product IDs");
  return { plans, assignments };
}

export async function seedDatabase(source: DataSource, input: DatabaseSeedInput = {}): Promise<DatabaseSeedResult> {
  const validated: DatabaseSeedInput = parseDatabaseSeedInput(input);
  return source.transaction(async (manager: EntityManager): Promise<DatabaseSeedResult> => {
    // Serialize seed runs across processes; release automatically on commit or rollback.
    await acquireBootstrapLock(manager);
    const result: DatabaseSeedResult = { rolesCreated: 0, plansCreated: 0, assignmentsCreated: 0, adminSuperAdded: false };
    for (const role of defaultSeedRoles()) {
      const existing: InfraRole | null = await manager.findOneBy(InfraRole, { id: role.id });
      if (existing) {
        if (role.id === "admin" && !new Role({ ...existing }).hasPermission(Permission.Super)) {
          await manager.update(InfraRole, { id: role.id }, { permission: existing.permission | permissionBits([Permission.Super]) });
          result.adminSuperAdded = true;
        }
        continue;
      }
      await manager.insert(InfraRole, { id: role.id, name: role.name, active: role.active, permission: role.getPermissionBits() });
      result.rolesCreated++;
    }
    for (const plan of validated.plans ?? []) {
      if (await manager.existsBy(InfraPlan, { id: plan.id })) continue;
      await manager.insert(InfraPlan, plan);
      result.plansCreated++;
    }
    for (const assignment of validated.assignments ?? []) {
      const user: InfraUser | null = await manager.findOneBy(InfraUser, { id: assignment.userId });
      if (!user || !user.active || user.suspended) throw new Error("Seed assignments require an existing active, unsuspended user");
      if (await manager.existsBy(InfraUserRole, assignment)) continue;
      await manager.insert(InfraUserRole, assignment);
      result.assignmentsCreated++;
    }
    return result;
  });
}
