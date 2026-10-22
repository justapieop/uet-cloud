import type { AdminPlanWrite } from "@/entities/plan/admin";
import type { AdminResult } from "@/shared/api/admin-errors";

export function parsePlan(form: FormData): AdminResult<AdminPlanWrite> {
  const text: (key: string) => string = (key: string): string => String(form.get(key) ?? "").trim();
  const name: string = text("name");
  if (!name || name.length > 255) return { error: "Enter a plan name of up to 255 characters." };
  const price: number = Number(text("price"));
  const vcpu: number = Number(text("vcpu"));
  const deployments: number = Number(text("deployments"));
  const disk: number = Number(text("disk"));
  const replicas: number = Number(text("max_replicas"));
  if (!text("price") || !Number.isFinite(price) || price < 0 || price > 999999999999999 || !/^\d+(?:\.\d{1,4})?$/.test(text("price"))) return { error: "Enter a nonnegative catalog price with at most four decimal places." };
  if (!Number.isFinite(vcpu) || vcpu < 0.25 || !Number.isInteger(vcpu * 4)) return { error: "Use vCPU in increments of 0.25." };
  if (![deployments, disk, replicas].every((value: number): boolean => Number.isSafeInteger(value) && value >= 1)) return { error: "Deployment, storage, and replica quotas must be positive whole numbers." };
  const product: string = text("stripe_product_id");
  if (product && (product.length > 255 || !/^prod_[A-Za-z0-9]+$/.test(product))) return { error: "Enter a Stripe product ID beginning with prod_, or leave it blank." };
  return { data: { name, price, vcpu, memory: vcpu * 2, deployments, disk, max_replicas: replicas, active: form.get("active") === "on", stripe_product_id: product || null } };
}
