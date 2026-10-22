import { redirect } from "next/navigation";
import type { JSX } from "react";
import { getAccountAccess, type AccountAccess } from "@/features/auth/server";
import { AccessCheckPage } from "@/views/access-check";
import { HomePage } from "@/views/home";

export default async function HomeRoute(): Promise<JSX.Element> {
  const access: AccountAccess = await getAccountAccess();
  if (access.kind === "subscribed") redirect("/dashboard");
  if (access.kind === "needs-plan") redirect("/plans");
  if (access.kind === "unavailable" || access.kind === "forbidden") {
    return <AccessCheckPage retryHref="/" forbidden={access.kind === "forbidden"} />;
  }
  return <HomePage />;
}