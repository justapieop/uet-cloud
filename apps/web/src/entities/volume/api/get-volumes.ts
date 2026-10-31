import "server-only";

import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";
import type { VolumeItem } from "../model/types";

export type VolumesResult =
  | { readonly kind: "success"; readonly volumes: VolumeItem[] }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "error"; readonly message: string };

export async function getVolumes(): Promise<VolumesResult> {
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return { kind: "unauthorized" };

  try {
    const result: { data?: VolumeItem[]; response: Response } = await apiClient.GET("/volumes", {
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (result.response.status === 401 || result.response.status === 403) return { kind: "unauthorized" };
    if (!result.response.ok || !result.data) {
      return { kind: "error", message: "Volumes could not be loaded. Try refreshing." };
    }
    return { kind: "success", volumes: result.data };
  } catch {
    return { kind: "error", message: "The volume service could not be reached. Try refreshing." };
  }
}
