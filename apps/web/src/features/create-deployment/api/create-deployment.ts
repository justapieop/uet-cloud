"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Deployment } from "@/entities/deployment";
import { apiClient } from "@/shared/api/server";
import { parseDeploymentInput, type DeploymentInputResult } from "../model/request";

export type CreateDeploymentResult = { readonly id: string; readonly error?: never } | { readonly error: string; readonly id?: never };

export async function createDeployment(form: FormData, idempotencyKey: string): Promise<CreateDeploymentResult> {
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return { error: "Your session has expired. Sign in again to create a deployment." };
  if (!/^[\x21-\x7e]{1,255}$/.test(idempotencyKey)) return { error: "Refresh the page and try again." };
  const input: DeploymentInputResult = parseDeploymentInput(form);
  if (!input.data) return { error: input.error };
  try {
    const result: { data?: Deployment; error?: unknown; response: Response } = await apiClient.POST("/deployments", {
      params: { header: { "Idempotency-Key": idempotencyKey } },
      headers: { cookie }, body: input.data, cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    if (!result.response.ok) {
      const status: number = result.response.status;
      if (status === 400) return { error: "The deployment settings were rejected. Check the repository, resources, and build settings." };
      if (status === 401) return { error: "Your session has expired. Sign in again." };
      if (status === 403) return { error: "Your account needs an active plan and permission to create deployments." };
      if (status === 409) return { error: "That name is already in use, or this deployment exceeds your plan limits. Check your existing deployments and resource settings." };
      if (status === 422) return { error: "This request key was already used with different settings. Change the settings or refresh the page to start a new request." };
      if (status === 503) return { error: "Subscription verification is temporarily unavailable. Retry with the same settings." };
      return { error: "The deployment service is unavailable. Retry with the same settings." };
    }
    if (!result.data?.id) return { error: "The service did not confirm the deployment. Retry with the same settings to check this request." };
    revalidatePath("/dashboard");
    return { id: result.data.id };
  } catch {
    return { error: "The request could not be confirmed. Retry with the same settings to avoid creating a duplicate deployment." };
  }
}
