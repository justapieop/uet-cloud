import "server-only";

import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";
import type { Deployment } from "../model/types";

export type DeploymentResult =
  | { readonly kind: "success"; readonly deployment: Deployment }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "not_found" }
  | { readonly kind: "error"; readonly message: string };

export async function getDeployment(id: string): Promise<DeploymentResult> {
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return { kind: "unauthorized" };

  try {
    const result: { data?: Deployment; response: Response } = await apiClient.GET("/deployments/{id}", {
      params: { path: { id } },
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (result.response.status === 401 || result.response.status === 403) return { kind: "unauthorized" };
    if (result.response.status === 404) return { kind: "not_found" };
    if (!result.response.ok || !result.data) {
      return {
        kind: "error",
        message: result.response.status === 400 ? "Invalid deployment identifier." : "Deployment details could not be loaded.",
      };
    }
    return { kind: "success", deployment: result.data };
  } catch {
    return { kind: "error", message: "The deployment service could not be reached. Try refreshing." };
  }
}
