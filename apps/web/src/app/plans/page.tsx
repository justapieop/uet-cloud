import { redirect } from "next/navigation";
import type { JSX } from "react";
import { getAccountAccess, type AccountAccess } from "@/features/auth/server";
import { AccessCheckPage } from "@/views/access-check";
import { PlansPage } from "@/views/plans";

export default async function PlansRoute(): Promise<JSX.Element> {
  const access: AccountAccess = await getAccountAccess();
  if (access.kind === "signed-out") redirect("/login");
  if (access.kind === "subscribed") redirect("/dashboard");
  if (access.kind === "unavailable" || access.kind === "forbidden") {
    return <AccessCheckPage retryHref="/plans" forbidden={access.kind === "forbidden"} />;
  }
  return <PlansPage />;
}