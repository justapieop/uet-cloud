import "server-only";

import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";
import type { Deployment, DeploymentFilters } from "../model/types";

export type DeploymentsResult =
  | { readonly kind: "success"; readonly deployments: Deployment[] }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "error"; readonly message: string };

export async function getDeployments(filters: DeploymentFilters): Promise<DeploymentsResult> {
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return { kind: "unauthorized" };

  try {
    const result: { data?: Deployment[]; response: Response } = await apiClient.GET("/deployments", {
      headers: { cookie }, params: { query: filters }, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (result.response.status === 401 || result.response.status === 403) return { kind: "unauthorized" };
    if (!result.response.ok || !result.data) {
      return { kind: "error", message: result.response.status === 400 ? "These filters are invalid. Clear them and try again." : "Deployments could not be loaded. Try refreshing." };
    }
    return { kind: "success", deployments: result.data };
  } catch {
    return { kind: "error", message: "The deployment service could not be reached. Try refreshing." };
  }
}
