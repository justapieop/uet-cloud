"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";
import {
  type AttachVolumeInput,
  type VolumeActionResult,
  VOLUME_NAME_REGEX,
  MOUNT_PATH_REGEX,
} from "../model/types";

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

function extractBackendErrorMessage(errorData: unknown, fallback: string): string {
  if (errorData && typeof errorData === "object") {
    const record: Record<string, unknown> = errorData as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (Array.isArray(record.message) && typeof record.message[0] === "string" && record.message[0].trim()) {
      return record.message[0];
    }
    if (typeof record.error === "string" && record.error.trim()) return record.error;
  }
  if (typeof errorData === "string" && errorData.trim()) {
    return errorData;
  }
  return fallback;
}

export async function attachVolumeAction(
  deploymentId: string,
  input: AttachVolumeInput,
): Promise<VolumeActionResult> {
  const cookieHeader: string | null = (await headers()).get("cookie");
  if (!cookieHeader) {
    return { success: false, error: "Authentication required" };
  }

  const name: string = input.name.trim();
  const mountPath: string = input.mount_path.trim();
  const subPath: string | undefined = input.sub_path?.trim() || undefined;
  const sizeGb: number = Number(input.size_gb);
  const accessMode: "ReadWrite" | "ReadOnly" = input.access_mode ?? "ReadWrite";

  if (!VOLUME_NAME_REGEX.test(name)) {
    return {
      success: false,
      error: "Volume name must be 2–32 lowercase letters, numbers, or hyphens, starting and ending with an alphanumeric character.",
    };
  }

  if (!MOUNT_PATH_REGEX.test(mountPath)) {
    return {
      success: false,
      error: "Mount path must be an absolute path inside the container starting with /.",
    };
  }

  if (!Number.isInteger(sizeGb) || sizeGb < 32 || sizeGb > 262144) {
    return {
      success: false,
      error: "Volume capacity must be an integer between 32 and 262,144 GiB (256 TiB).",
    };
  }

  try {
    const result: { data?: unknown; error?: unknown; response: Response } = await apiClient.POST("/deployments/{id}/volumes", {
      params: { path: { id: deploymentId } },
      headers: { cookie: cookieHeader },
      body: {
        name,
        mount_path: mountPath,
        sub_path: subPath,
        size_gb: sizeGb,
        access_mode: accessMode,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });

    if (!result.response.ok) {
      const status: number = result.response.status;
      if (status === 400) {
        const message: string = extractBackendErrorMessage(
          result.error,
          "Invalid volume parameters. Check volume name, mount path, and size.",
        );
        return { success: false, error: message };
      }
      if (status === 403) {
        const message: string = extractBackendErrorMessage(
          result.error,
          "An active plan subscription is required to attach persistent storage volumes.",
        );
        return { success: false, error: message };
      }
      if (status === 404) {
        const message: string = extractBackendErrorMessage(
          result.error,
          "Deployment was not found.",
        );
        return { success: false, error: message };
      }
      if (status === 409) {
        const message: string = extractBackendErrorMessage(
          result.error,
          "Cannot attach volume. Deployment must be in RUNNING or STOPPED status, or disk quota was exceeded.",
        );
        return { success: false, error: message };
      }
      const message: string = extractBackendErrorMessage(
        result.error,
        `Failed to attach volume (HTTP ${status})`,
      );
      return { success: false, error: message };
    }

    revalidatePath(`/dashboard/deployments/${deploymentId}`);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/volumes");
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: extractErrorMessage(error, "Failed to connect to volume service") };
  }
}

export async function detachVolumeAction(
  deploymentId: string,
  volumeName: string,
  deleteData: boolean,
): Promise<VolumeActionResult> {
  const cookieHeader: string | null = (await headers()).get("cookie");
  if (!cookieHeader) {
    return { success: false, error: "Authentication required" };
  }

  try {
    const result: { data?: unknown; error?: unknown; response: Response } = await apiClient.DELETE(
      "/deployments/{id}/volumes/{volumeName}",
      {
        params: {
          path: { id: deploymentId, volumeName },
          query: { delete_data: deleteData ? "true" : "false" },
        },
        headers: { cookie: cookieHeader },
        cache: "no-store",
        signal: AbortSignal.timeout(90_000),
      },
    );

    if (!result.response.ok) {
      const status: number = result.response.status;
      if (status === 400) {
        const message: string = extractBackendErrorMessage(
          result.error,
          "Invalid deployment identifier or volume name.",
        );
        return { success: false, error: message };
      }
      if (status === 404) {
        const message: string = extractBackendErrorMessage(
          result.error,
          "Deployment or volume was not found.",
        );
        return { success: false, error: message };
      }
      if (status === 409) {
        const message: string = extractBackendErrorMessage(
          result.error,
          "Cannot detach volume. Deployment must be in RUNNING or STOPPED status.",
        );
        return { success: false, error: message };
      }
      const message: string = extractBackendErrorMessage(
        result.error,
        `Failed to detach volume (HTTP ${status})`,
      );
      return { success: false, error: message };
    }

    revalidatePath(`/dashboard/deployments/${deploymentId}`);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/volumes");
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: extractErrorMessage(error, "Failed to connect to volume service") };
  }
}
