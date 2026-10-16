"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";

const SIGN_OUT_ERROR: string = "Unable to sign out. Please try again.";

export async function signOut(): Promise<string | null> {
  const cookieHeader: string | null = (await headers()).get("cookie");

  if (cookieHeader) {
    try {
      const result: { response: Response } = await apiClient.POST("/auth/logout", {
        headers: { cookie: cookieHeader },
        cache: "no-store",
        parseAs: "text",
        signal: AbortSignal.timeout(5000),
      });

      if (!result.response.ok) {
        return SIGN_OUT_ERROR;
      }
    } catch {
      return SIGN_OUT_ERROR;
    }
  }

  revalidatePath("/", "layout");
  return null;
}
