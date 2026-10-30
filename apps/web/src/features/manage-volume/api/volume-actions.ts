"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";
import type { VolumeItem } from "@/entities/volume";
import { VOLUME_NAME_REGEX, type VolumeActionResult } from "../model/types";

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.message.toLowerCase().includes("timeout")) {
      return "Request timed out while contacting volume service";
    }
    if (error.message) {
      return error.message;
    }
  }
  return fallback;
}

async function parseBackendErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === "object") {
      const record: Record<string, unknown> = data as Record<string, unknown>;
      if (typeof record.message === "string") return record.message;
      if (Array.isArray(record.message) && typeof record.message[0] === "string") return record.message[0];
    }
  } catch {
    // If response body is not JSON or cannot be read, fall back
  }
  return fallback;
}

export async function createStandaloneVolumeAction(input: {
  readonly name: string;
  readonly size_gb: number;
  readonly region?: string;
}): Promise<VolumeActionResult> {
  const cookieHeader: string | null = (await headers()).get("cookie");
  if (!cookieHeader) {
    return { success: false, error: "Authentication required" };
  }

  const name: string = input.name.trim();
  const sizeGb: number = Number(input.size_gb);
  const region: string | undefined = input.region?.trim() || undefined;

  if (!VOLUME_NAME_REGEX.test(name)) {
    return {
      success: false,
      error: "Volume name must be 2–32 lowercase letters, numbers, or hyphens, starting and ending with an alphanumeric character.",
    };
  }

  if (!Number.isInteger(sizeGb) || sizeGb < 32 || sizeGb > 262144) {
    return {
      success: false,
      error: "Volume capacity must be an integer between 32 and 262,144 GiB (256 TiB).",
    };
  }

  try {
    const result: { response: Response } = await apiClient.POST("/volumes", {
      headers: { cookie: cookieHeader },
      body: {
        name,
        size_gb: sizeGb,
        region,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });

    if (!result.response.ok) {
      const status: number = result.response.status;
      if (status === 400) {
        const message: string = await parseBackendErrorMessage(
          result.response,
          "Invalid volume parameters. Please check the name and size.",
        );
        return { success: false, error: message };
      }
      if (status === 403) {
        return { success: false, error: "Volume creation requires an active subscription linked to a Kumo plan." };
      }
      if (status === 409) {
        const message: string = await parseBackendErrorMessage(
          result.response,
          "Volume name already exists or plan disk quota exceeded.",
        );
        return { success: false, error: message };
      }
      const message: string = await parseBackendErrorMessage(
        result.response,
        `Volume creation failed (${status}). Please try again.`,
      );
      return { success: false, error: message };
    }

    revalidatePath("/dashboard/volumes");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: extractErrorMessage(error, "Failed to connect to volume service. Please try again.") };
  }
}

export async function deleteStandaloneVolumeAction(name: string): Promise<VolumeActionResult> {
  const cookieHeader: string | null = (await headers()).get("cookie");
  if (!cookieHeader) {
    return { success: false, error: "Authentication required" };
  }

  const volumeName: string = name.trim();
  if (!volumeName) {
    return { success: false, error: "Volume name is required" };
  }

  try {
    const result: { response: Response } = await apiClient.DELETE("/volumes/{name}", {
      params: { path: { name: volumeName } },
      headers: { cookie: cookieHeader },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });

    if (!result.response.ok) {
      const status: number = result.response.status;
      if (status === 404) {
        return { success: false, error: "Volume not found." };
      }
      if (status === 409) {
        const message: string = await parseBackendErrorMessage(
          result.response,
          "Volume cannot be deleted while attached to one or more active deployments.",
        );
        return { success: false, error: message };
      }
      const message: string = await parseBackendErrorMessage(
        result.response,
        `Failed to delete volume (${status}).`,
      );
      return { success: false, error: message };
    }

    revalidatePath("/dashboard/volumes");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: extractErrorMessage(error, "Failed to connect to volume service. Please try again.") };
  }
}

export async function getUserVolumesAction(): Promise<VolumeItem[]> {
  const cookieHeader: string | null = (await headers()).get("cookie");
  if (!cookieHeader) return [];

  try {
    const result: { data?: VolumeItem[]; response: Response } = await apiClient.GET("/volumes", {
      headers: { cookie: cookieHeader },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (result.response.ok && result.data) {
      return result.data;
    }
  } catch {
    // Return empty array
  }
  return [];
}
