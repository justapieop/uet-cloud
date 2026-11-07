import type { ScaleRule } from "@kumo/domain";

export interface ScaleRuleRepository {
  findByDeploymentId(deploymentId: string): Promise<ScaleRule | null>;
  save(rule: ScaleRule): Promise<void>;
  delete(deploymentId: string): Promise<void>;
}

export interface DeploymentScalingSnapshot {
  readonly revisionName: string;
  readonly replicaNames: readonly string[];
  readonly cpuCores: number;
  readonly memoryGiB: number;
  readonly revisionCreatedAt: Date;
}

export interface DeploymentScalingIdentity {
  readonly deploymentId: string;
  readonly userId: string;
  readonly appName: string;
  readonly resourceId: string;
}

export interface DeploymentScaler {
  inspect(input: DeploymentScalingIdentity, signal: AbortSignal): Promise<DeploymentScalingSnapshot>;
  scale(input: DeploymentScalingIdentity & {
    readonly expected: DeploymentScalingSnapshot;
    readonly targetReplicas: number;
    readonly operationId: string;
  }, signal: AbortSignal): Promise<void>;
}

export class ScaleRuleNotFoundError extends Error {}
export class ScaleRuleConflictError extends Error {}
export class DeploymentScalingUnavailableError extends Error {
  public constructor() { super("Scaling requires a healthy single-revision app with one container, ingress, no custom scale rules, and ready replicas"); }
}
