import { redirect } from "next/navigation";
import type { JSX } from "react";
import { getAccountAccess, type AccountAccess } from "@/features/auth/server";
import { AccessCheckPage } from "@/views/access-check";
import { CreateDeploymentPage } from "@/views/create-deployment";

export default async function CreateDeploymentRoute(): Promise<JSX.Element> {
  const access: AccountAccess = await getAccountAccess();
  if (access.kind === "signed-out") redirect("/login");
  if (access.kind === "needs-plan") redirect("/plans");
  if (access.kind === "unavailable" || access.kind === "forbidden") return <AccessCheckPage retryHref="/dashboard/create" forbidden={access.kind === "forbidden"} />;
  return <CreateDeploymentPage />;
}
