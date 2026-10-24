"use server";

import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";
import type { GitHubRepositoryPage, RepositoryResult } from "../model/repositories";

export async function getRepositories(page: number = 1): Promise<RepositoryResult> {
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000) {
    return { error: "Invalid repository page. Refresh and try again." };
  }
  const cookie: string | null = (await headers()).get("cookie");
  if (!cookie) return { error: "Sign in again to load your GitHub repositories." };
  try {
    const result: { data?: GitHubRepositoryPage; response: Response } = await apiClient.GET("/auth/github/repositories", {
      params: { query: { page, per_page: 30 } },
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (result.response.status === 401 || result.response.status === 403) {
      return { error: "Your session cannot load repositories. Sign in again and check your account access." };
    }
    if (!result.response.ok || !result.data) {
      return { error: "GitHub repositories are temporarily unavailable. Try again." };
    }
    return { data: result.data };
  } catch {
    return { error: "GitHub repositories could not be loaded. Check your connection and try again." };
  }
}
