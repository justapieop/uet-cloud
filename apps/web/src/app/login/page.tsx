import { redirect } from "next/navigation";
import type { JSX } from "react";
import { getAccountAccess, type AccountAccess } from "@/features/auth/server";
import { AccessCheckPage } from "@/views/access-check";
import { LoginPage } from "@/views/login";

export default async function LoginRoute(): Promise<JSX.Element> {
  const access: AccountAccess = await getAccountAccess();
  if (access.kind === "subscribed") redirect("/dashboard");
  if (access.kind === "needs-plan") redirect("/plans");
  if (access.kind === "unavailable" || access.kind === "forbidden") {
    return <AccessCheckPage retryHref="/login" forbidden={access.kind === "forbidden"} />;
  }
  return <LoginPage />;
}