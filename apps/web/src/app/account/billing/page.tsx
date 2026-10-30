import { redirect } from "next/navigation";
import type { JSX } from "react";
import { getCurrentUser, type CurrentUser } from "@/features/auth/server";
import { BillingPage } from "@/views/billing";

export default async function BillingRoute(): Promise<JSX.Element> {
  const user: CurrentUser | null = await getCurrentUser();
  if (!user) redirect("/login");

  return <BillingPage />;
}
