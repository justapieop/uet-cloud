import { redirect } from "next/navigation";
import type { JSX } from "react";
import { getAccountAccess, type AccountAccess } from "@/features/auth/server";
import { AccessCheckPage } from "@/views/access-check";
import { VolumesPage } from "@/views/volumes";
import { getVolumes, type VolumesResult } from "@/entities/volume/server";

export default async function VolumesRoute(): Promise<JSX.Element> {
  const access: AccountAccess = await getAccountAccess();
  if (access.kind === "signed-out") redirect("/login");
  if (access.kind === "needs-plan") redirect("/plans");
  if (access.kind === "unavailable" || access.kind === "forbidden") {
    return <AccessCheckPage retryHref="/dashboard/volumes" forbidden={access.kind === "forbidden"} />;
  }

  const result: VolumesResult = await getVolumes();
  return <VolumesPage result={result} />;
}
