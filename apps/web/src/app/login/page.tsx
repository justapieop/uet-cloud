import { redirect } from "next/navigation";
import type { JSX } from "react";
import { getCurrentUser, type CurrentUser } from "@/features/auth/server";
import { LoginPage } from "@/views/login";

export default async function LoginRoute(): Promise<JSX.Element> {
  const user: CurrentUser | null = await getCurrentUser();

  if (user) {
    redirect("/dashboard");
  }

  return <LoginPage />;
}
