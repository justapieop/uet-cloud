"use server";

import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";
import type { DeploymentRegion, RegionsResult } from "../model/regions";

export async function getRegions(): Promise<RegionsResult> {
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return { error: "Sign in again to load deployment regions." };
  try {
    const result: { data?: DeploymentRegion[]; response: Response } = await apiClient.GET("/regions", {
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(35_000),
    });
    if (result.response.status === 401 || result.response.status === 403) {
      return { error: "Your session cannot load regions. Sign in again and check your account access." };
    }
    if (!result.response.ok || !result.data) return { error: "Deployment regions are temporarily unavailable. Try again." };
    return { data: result.data };
  } catch {
    return { error: "Deployment regions could not be loaded. Check your connection and try again." };
  }
}
