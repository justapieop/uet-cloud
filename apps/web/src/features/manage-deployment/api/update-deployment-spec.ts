"use server";

import { headers } from "next/headers";
import { validateComputeConfiguration, type ComputeConfiguration } from "@/entities/deployment";
import { apiClient } from "@/shared/api/server";
import {
  computeConfigurationsEqual, resourceUpdateRequestError,
  type ResourceUpdateReceipt, type UpdateDeploymentSpecResult,
} from "../model/deployment-spec";

export async function updateDeploymentSpec(
  id: string,
  configuration: ComputeConfiguration,
  configurationVersion: string,
  idempotencyKey: string,
): Promise<UpdateDeploymentSpecResult> {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return resourceUpdateRequestError(400, null);
  }
  if (typeof configuration !== "object" || configuration === null || Array.isArray(configuration) ||
      Object.keys(validateComputeConfiguration(configuration)).length > 0) {
    return resourceUpdateRequestError(400, null);
  }
  if (typeof configurationVersion !== "string" || !/^[\x21-\x7e]{1,255}$/.test(configurationVersion) ||
      configurationVersion === "*" || configurationVersion.startsWith("W/") || configurationVersion.includes(",")) {
    return resourceUpdateRequestError(428, null);
  }
  if (typeof idempotencyKey !== "string" || !/^[\x20-\x7e]{1,255}$/.test(idempotencyKey)) {
    return resourceUpdateRequestError(400, null);
  }
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return resourceUpdateRequestError(401, null);

  try {
    const result: { data?: ResourceUpdateReceipt; error?: unknown; response: Response } = await apiClient.PATCH("/deployments/{id}", {
      params: { path: { id }, header: { "If-Match": configurationVersion, "Idempotency-Key": idempotencyKey } },
      headers: { cookie },
      body: {
        max_vcpu: configuration.max_vcpu, max_memory: configuration.max_memory,
        min_scaling: configuration.min_scaling, max_scaling: configuration.max_scaling,
      },
      cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    if (!result.response.ok) return resourceUpdateRequestError(result.response.status, result.error);
    const receipt: ResourceUpdateReceipt | undefined = result.data;
    if (result.response.status !== 202 || !receipt || receipt.status !== "PENDING" || receipt.deployment_id !== id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt.operation_id) ||
        !receipt.requested || !computeConfigurationsEqual(receipt.requested, configuration)) {
      return resourceUpdateRequestError(null, null);
    }
    // Keep displayed applied values until polling verifies this accepted operation.
    return { kind: "accepted", operation: receipt };
  } catch {
    // The command may already exist. The caller retains its key and exact payload for retry.
    return resourceUpdateRequestError(null, null);
  }
}
