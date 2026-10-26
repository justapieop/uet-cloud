"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";

export interface LifecycleActionResult {
  readonly success: boolean;
  readonly error?: string;
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.message.toLowerCase().includes("timeout")) {
      return "Request timed out while contacting deployment service";
    }
    if (error.message) {
      return error.message;
    }
  }
  return fallback;
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
      if (result.response.status === 409) {
        return { success: false, error: "Unable to start container. Ensure it is in stopped state." };
      }
      if (result.response.status === 404) {
        return { success: false, error: "Deployment was not found." };
      }
      return { success: false, error: `Failed to start container (HTTP ${result.response.status})` };
    }

    revalidatePath("/dashboard");
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: extractErrorMessage(error, "Failed to connect to deployment service") };
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
      if (result.response.status === 409) {
        return { success: false, error: "Unable to stop container. Ensure it is currently running." };
      }
      if (result.response.status === 404) {
        return { success: false, error: "Deployment was not found." };
      }
      return { success: false, error: `Failed to stop container (HTTP ${result.response.status})` };
    }

    revalidatePath("/dashboard");
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: extractErrorMessage(error, "Failed to connect to deployment service") };
  }
}
