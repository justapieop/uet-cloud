import { redirect } from "next/navigation";
import type { JSX } from "react";
import { getCurrentUser, type CurrentUser } from "@/features/auth/server";
import { AdminPage } from "@/views/admin";

export default async function AdminRoute(props: Parameters<typeof AdminPage>[0]): Promise<JSX.Element> {
  const user: CurrentUser | null = await getCurrentUser();
  if (!user) redirect("/login");
  return <AdminPage {...props} />;
}
