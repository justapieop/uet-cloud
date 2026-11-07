import type { components } from "@kumo/rest";
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

export type ResourceUpdate = components["schemas"]["DeploymentResourceUpdateResponseDto"];
export type ResourceUpdateReceipt = components["schemas"]["DeploymentResourceUpdateReceiptDto"];

export interface DeploymentResourceRequestError {
  readonly kind: "error";
  readonly message: string;
  readonly code: string | null;
  readonly status: number | null;
  readonly outcomeUnknown: boolean;
  readonly retryable: boolean;
}

export type UpdateDeploymentSpecResult =
  | { readonly kind: "accepted"; readonly operation: ResourceUpdateReceipt }
  | DeploymentResourceRequestError;

export type GetDeploymentResourceUpdateResult =
  | { readonly kind: "ready"; readonly operation: ResourceUpdate }
  | DeploymentResourceRequestError;

export function isResourceUpdateActive(operation: ResourceUpdate | null | undefined): boolean {
  return operation?.status === "PENDING" || operation?.status === "APPLYING" || operation?.status === "RECONCILING";
}

const SAFE_RESOURCE_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  "RESOURCE_UPDATES_DISABLED", "RESOURCE_STOPPED_UNSUPPORTED", "RESOURCE_REVISION_MODE_UNSUPPORTED",
  "RESOURCE_BASELINE_UNSETTLED", "RESOURCE_BASELINE_CHANGED", "RESOURCE_DEPLOYMENT_CHANGED",
  "CONFIGURATION_VERSION_MISMATCH", "CONFIGURATION_VERSION_REQUIRED", "RESOURCE_QUOTA_EXCEEDED",
  "DEPLOYMENT_QUOTA_EXCEEDED", "IDEMPOTENCY_KEY_REUSED", "IDEMPOTENCY_KEY_IN_USE",
  "RESOURCE_UPDATES_UNAVAILABLE", "RESOURCE_SUBSCRIPTION_REQUIRED", "RESOURCE_READ_UNAVAILABLE",
  "RESOURCE_PREFLIGHT_UNAVAILABLE", "RESOURCE_LIFECYCLE_UNSUPPORTED", "RESOURCE_CONFIGURATION_INVALID",
  "RESOURCE_IDENTITY_INVALID", "RESOURCE_MISSING", "RESOURCE_REVISION_FAILED", "RESOURCE_BILLING_UNAVAILABLE",
]);

export function getResourceUpdateErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error) || typeof error.code !== "string") return null;
  return SAFE_RESOURCE_ERROR_CODES.has(error.code) ? error.code : null;
}

export function resourceUpdateErrorMessage(status: number | null, code: string | null): string {
  if (code === "RESOURCE_UPDATES_DISABLED") return "Resource updates are disabled on the deployment service. Ask your platform administrator to enable them.";
  if (code === "RESOURCE_STOPPED_UNSUPPORTED") return "Resource changes for stopped deployments are not supported yet. Start this deployment before editing its resources.";
  if (code === "RESOURCE_REVISION_MODE_UNSUPPORTED") return "Resource updates require Single revision mode without pinned or split traffic.";
  if (code === "RESOURCE_BASELINE_UNSETTLED") return "The current Azure revision is not ready or stable. Wait for its rollout to finish, then refresh the configuration.";
  if (code === "RESOURCE_BASELINE_CHANGED" || code === "RESOURCE_DEPLOYMENT_CHANGED" || status === 412) return "The deployment configuration changed. Refresh its current values before submitting again.";
  if (code === "RESOURCE_QUOTA_EXCEEDED" || code === "DEPLOYMENT_QUOTA_EXCEEDED") return "CPU, memory and maximum replicas must fit within one active plan.";
  if (code === "RESOURCE_SUBSCRIPTION_REQUIRED") return "An active plan is required to update this deployment. Check your subscription before retrying.";
  if (code === "RESOURCE_BILLING_UNAVAILABLE") return "Your subscription could not be verified. Try again once the billing service is available.";
  if (code === "RESOURCE_REVISION_FAILED") return "Azure could not make the requested resource revision ready. Refresh the applied configuration before trying again.";
  if (status === 400) return "The resource settings were rejected. Check CPU, memory and replica limits.";
  if (status === 401) return "Your session has expired. Sign in again to continue.";
  if (status === 403) return "An active plan and permission to update this deployment are required.";
  if (status === 404) return "This deployment or resource update could not be found for your account.";
  if (status === 409) return "The deployment is busy or cannot accept these resource settings. Refresh its status before retrying.";
  if (status === 422) return "This request key was already used with different settings. Refresh the configuration before starting a new request.";
  if (status === 428) return "The current configuration version is missing. Refresh the deployment before saving.";
  if (status === 429) return "The deployment service is busy. Wait a moment before retrying.";
  if (status === null) return "The request could not be confirmed. Retry with the same settings to check its result safely.";
  return "The deployment service could not confirm this request. Retry with the same settings in a moment.";
}

export function resourceUpdateFailureMessage(code: string | null): string {
  if (code === "RESOURCE_REVISION_FAILED" || code === "RESOURCE_QUOTA_EXCEEDED" || code === "RESOURCE_SUBSCRIPTION_REQUIRED" ||
      code === "RESOURCE_BILLING_UNAVAILABLE" || code === "RESOURCE_BASELINE_CHANGED" || code === "RESOURCE_DEPLOYMENT_CHANGED" ||
      code === "RESOURCE_BASELINE_UNSETTLED" || code === "RESOURCE_STOPPED_UNSUPPORTED") return resourceUpdateErrorMessage(409, code);
  return "The resource update failed. Refresh the applied configuration before starting another request.";
}

export function resourceUpdateRequestError(status: number | null, error: unknown): DeploymentResourceRequestError {
  const code: string | null = getResourceUpdateErrorCode(error);
  const unavailable: boolean = status === null || status >= 500;
  return {
    kind: "error", code, status, message: resourceUpdateErrorMessage(status, code),
    outcomeUnknown: unavailable && code !== "RESOURCE_UPDATES_DISABLED",
    retryable: code !== "RESOURCE_UPDATES_DISABLED" && code !== "RESOURCE_STOPPED_UNSUPPORTED" &&
      code !== "RESOURCE_REVISION_MODE_UNSUPPORTED" && (unavailable || status === 409 || status === 429),
  };
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
  if (isResourceUpdateActive(deployment.resource_update)) return "A resource update is already in progress. View its progress before making another change.";
  if (deployment.status === "STOPPED") return "Start this deployment before editing resources. Updating a stopped app is not supported yet.";
  if (deployment.status !== "RUNNING") {
    return "Resources can be edited when this deployment is running.";
  }
  if (!deployment.resource_id) return "This deployment has no provisioned resource to edit.";
  if (!getDeploymentComputeConfiguration(deployment)) {
    return "The applied resource configuration is incomplete. Refresh to load its current values.";
  }
  if (!deployment.configuration_version) return "The applied revision is not ready for resource updates. Refresh once its rollout is complete.";
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
    configuration_version: deployment.configuration_version,
    max_vcpu: deployment.max_vcpu,
    max_memory: deployment.max_memory,
    min_scaling: deployment.min_scaling,
    max_scaling: deployment.max_scaling,
  });
}
