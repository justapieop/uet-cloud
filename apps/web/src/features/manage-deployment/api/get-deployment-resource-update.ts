"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";
import { validateComputeConfiguration } from "@/entities/deployment";
import { computeConfigurationsEqual, resourceUpdateRequestError, type GetDeploymentResourceUpdateResult, type ResourceUpdate } from "../model/deployment-spec";

export async function getDeploymentResourceUpdate(id: string, operationId: string): Promise<GetDeploymentResourceUpdateResult> {
  const uuid: RegExp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof id !== "string" || typeof operationId !== "string" || !uuid.test(id) || !uuid.test(operationId)) {
    return resourceUpdateRequestError(400, null);
  }
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return resourceUpdateRequestError(401, null);

  try {
    const result: { data?: ResourceUpdate; error?: unknown; response: Response } = await apiClient.GET("/deployments/{id}/resource-updates/{operationId}", {
      params: { path: { id, operationId } }, headers: { cookie, "Cache-Control": "no-cache" },
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (!result.response.ok) return resourceUpdateRequestError(result.response.status, result.error);
    const operation: ResourceUpdate | undefined = result.data;
    const statuses: readonly ResourceUpdate["status"][] = ["PENDING", "APPLYING", "RECONCILING", "SUCCEEDED", "FAILED"];
    if (!operation || typeof operation.operation_id !== "string" || operation.operation_id.toLowerCase() !== operationId.toLowerCase() ||
        typeof operation.deployment_id !== "string" || operation.deployment_id.toLowerCase() !== id.toLowerCase() || !statuses.includes(operation.status) ||
        !operation.requested || Object.keys(validateComputeConfiguration(operation.requested)).length > 0 ||
        (operation.observed !== null && (!operation.observed || Object.keys(validateComputeConfiguration(operation.observed)).length > 0)) ||
        (operation.status === "SUCCEEDED" && (!operation.observed || !computeConfigurationsEqual(operation.observed, operation.requested)))) {
      return resourceUpdateRequestError(null, null);
    }
    if (operation.status === "SUCCEEDED" || operation.status === "FAILED") {
      try { revalidatePath("/dashboard"); revalidatePath(`/dashboard/deployments/${id}`); } catch {}
    }
    return { kind: "ready", operation };
  } catch {
    return resourceUpdateRequestError(null, null);
  }
}
