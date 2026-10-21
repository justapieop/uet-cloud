import type { components, operations } from "@kumo/rest";

export type Deployment = components["schemas"]["DeploymentResponseDto"];
export type DeploymentFilters = NonNullable<operations["DeploymentsController_list"]["parameters"]["query"]>;

export const DEPLOYMENT_STATUSES: readonly Deployment["status"][] = ["PENDING", "PROVISIONING", "RUNNING", "FAILED", "DELETED"];
