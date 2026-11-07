import type { ComputeConfiguration } from "@/entities/deployment";
import type { UpdateDeploymentSpecResult } from "../model/deployment-spec";

// Replace this adapter with an authenticated server action when the update API exists.
export async function updateDeploymentSpec(
  _id: string,
  _configuration: ComputeConfiguration,
): Promise<UpdateDeploymentSpecResult> {
  return {
    kind: "not-implemented",
    message: "Resource changes cannot be applied yet. Your draft is still available; the deployment has not changed.",
  };
}
