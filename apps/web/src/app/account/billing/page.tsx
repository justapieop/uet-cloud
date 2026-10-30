import { redirect } from "next/navigation";
import type { JSX } from "react";
import { getCurrentUser, type CurrentUser } from "@/features/auth/server";

export default async function BillingRoute(): Promise<JSX.Element> {
  const user: CurrentUser | null = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <main className="min-h-dvh bg-background px-6 py-12 text-foreground sm:px-8 sm:py-16">
      <div className="mx-auto w-full max-w-6xl">
        <h1 className="text-3xl font-semibold tracking-tight">Billing</h1>
      </div>
    </main>
  );
}
