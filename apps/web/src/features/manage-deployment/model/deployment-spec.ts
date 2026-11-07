import {
  validateComputeConfiguration,
  type ComputeConfiguration,
  type Deployment,
} from "@/entities/deployment";
import type { Plan } from "@/entities/plan";

export type DeploymentEditContext =
  | { readonly kind: "ready"; readonly plans: readonly Plan[] }
  | { readonly kind: "no-plan" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unavailable" };

export interface UpdateDeploymentSpecResult {
  readonly kind: "not-implemented";
  readonly message: string;
}

export function getDeploymentComputeConfiguration(deployment: Deployment): ComputeConfiguration | null {
  const maxVcpu: number | null = deployment.max_vcpu;
  const maxMemory: number | null = deployment.max_memory;
  const minScaling: number | null = deployment.min_scaling;
  const maxScaling: number | null = deployment.max_scaling;

  if (maxVcpu === null || maxMemory === null || minScaling === null || maxScaling === null ||
      !Number.isFinite(maxVcpu) || !Number.isFinite(maxMemory) ||
      !Number.isFinite(minScaling) || !Number.isFinite(maxScaling)) {
    return null;
  }

  return {
    max_vcpu: maxVcpu,
    max_memory: maxMemory,
    min_scaling: minScaling,
    max_scaling: maxScaling,
  };
}

export function getDeploymentEditUnavailableReason(deployment: Deployment): string | null {
  if (deployment.status === "DELETED") return "Deleted deployments cannot be edited.";
  if (deployment.status === "DELETE_PENDING" || deployment.status === "DELETING" || deployment.status === "DELETE_FAILED") {
    return "Resources cannot be edited while deployment deletion is in progress or needs attention.";
  }
  if (deployment.status === "STARTING" || deployment.status === "STOPPING") {
    return "Wait for the current start or stop operation to finish before editing resources.";
  }
  if (deployment.status !== "RUNNING" && deployment.status !== "STOPPED") {
    return "Resources can be edited when this deployment is running or stopped.";
  }
  if (!deployment.resource_id) return "This deployment has no provisioned resource to edit.";
  if (!getDeploymentComputeConfiguration(deployment)) {
    return "The applied resource configuration is incomplete. Refresh to load its current values.";
  }
  return null;
}

export function computeConfigurationsEqual(left: ComputeConfiguration, right: ComputeConfiguration): boolean {
  return left.max_vcpu === right.max_vcpu && left.max_memory === right.max_memory &&
    left.min_scaling === right.min_scaling && left.max_scaling === right.max_scaling;
}

export function configurationFitsPlan(configuration: ComputeConfiguration, plans: readonly Plan[]): boolean {
  if (Object.keys(validateComputeConfiguration(configuration)).length > 0) return false;
  return plans.some((plan: Plan): boolean => configuration.max_vcpu <= plan.vcpu &&
    configuration.max_memory <= plan.memory && configuration.max_scaling <= plan.max_replicas);
}

export function getDeploymentSpecFingerprint(deployment: Deployment): string {
  return JSON.stringify({
    id: deployment.id,
    status: deployment.status,
    resource_id: deployment.resource_id,
    max_vcpu: deployment.max_vcpu,
    max_memory: deployment.max_memory,
    min_scaling: deployment.min_scaling,
    max_scaling: deployment.max_scaling,
  });
}
