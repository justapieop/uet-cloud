import "server-only";

import type { JSX } from "react";
import { headers } from "next/headers";
import { apiClient } from "@/shared/api/server";
import type { Deployment } from "@/entities/deployment";
import type { ScaleRule } from "../model/types";
import { ScaleRuleEditor } from "./scale-rule-editor";

export async function ScaleRuleCard({ deployment }: { readonly deployment: Deployment }): Promise<JSX.Element> {
  const cookie: string | null = (await headers()).get("cookie");
  let rule: ScaleRule | null = null;
  let error: string | null = null;
  try {
    if (!cookie) throw new Error("Authentication required");
    const result: { data?: ScaleRule[]; response: Response } = await apiClient.GET("/deployments/{id}/scale-rules", {
      params: { path: { id: deployment.id } }, headers: { cookie }, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (!result.response.ok || !result.data) error = result.response.status === 403 ? "You do not have permission to view scale rules." : "Scale rules could not be loaded. Refresh to try again.";
    else rule = result.data[0] ?? null;
  } catch { error = "Scale rules could not be loaded. Refresh to try again."; }
  return (
    <section aria-label="CPU auto scaling" className="rounded-xl border border-surface-border bg-surface/40 p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium">CPU auto scaling</h2>
        <span className={`text-xs ${rule?.enabled ? "text-emerald-300" : "text-muted-text"}`}>{rule?.enabled ? "Enabled" : "Disabled"}</span>
      </div>
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : (
        <ScaleRuleEditor key={`${rule?.updated_at ?? "new"}:${rule?.last_evaluated_at ?? "none"}`} deployment={deployment} rule={rule} />
      )}
    </section>
  );
}
