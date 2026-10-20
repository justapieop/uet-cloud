"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";

export interface LifecycleActionResult {
  readonly success: boolean;
  readonly error?: string;
}

export async function startDeploymentAction(id: string): Promise<LifecycleActionResult> {
  const cookieHeader: string | null = (await headers()).get("cookie");
  if (!cookieHeader) {
    return { success: false, error: "Authentication required" };
  }

  try {
    const result: { response: Response } = await apiClient.POST("/deployments/{id}/start", {
      params: { path: { id } },
      headers: { cookie: cookieHeader },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (!result.response.ok) {
      return { success: false, error: "Unable to start container. Ensure it is in stopped state." };
    }

    revalidatePath("/dashboard");
    return { success: true };
  } catch {
    return { success: false, error: "Failed to connect to deployment service" };
  }
}

export async function stopDeploymentAction(id: string): Promise<LifecycleActionResult> {
  const cookieHeader: string | null = (await headers()).get("cookie");
  if (!cookieHeader) {
    return { success: false, error: "Authentication required" };
  }

  try {
    const result: { response: Response } = await apiClient.POST("/deployments/{id}/stop", {
      params: { path: { id } },
      headers: { cookie: cookieHeader },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (!result.response.ok) {
      return { success: false, error: "Unable to stop container. Ensure it is currently running." };
    }

    revalidatePath("/dashboard");
    return { success: true };
  } catch {
    return { success: false, error: "Failed to connect to deployment service" };
  }
}
