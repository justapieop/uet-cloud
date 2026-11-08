import type { components, operations } from "@kumo/rest";

export type Deployment = components["schemas"]["DeploymentResponseDto"];
export type DeploymentFilters = NonNullable<operations["DeploymentsController_list"]["parameters"]["query"]>;

export const DEPLOYMENT_STATUSES: readonly NonNullable<DeploymentFilters["status"]>[] = [
  "PENDING", "PROVISIONING", "RUNNING", "STOPPED", "STARTING", "STOPPING", "SCALING", "FAILED",
  "DELETE_PENDING", "DELETING", "DELETE_FAILED", "DELETED",
];

const SLOT_RESERVING_STATUSES: readonly Deployment["status"][] = ["PENDING", "PROVISIONING", "RUNNING", "STARTING", "STOPPING", "SCALING"];

export function isDeploymentSlotReserved(deployment: Deployment): boolean {
  return SLOT_RESERVING_STATUSES.includes(deployment.status) ||
    (deployment.status === "FAILED" && deployment.resource_id !== null);
}
