"use server";

type SetMyCancellationResult =
  | { readonly kind: "demo-success"; readonly message: string }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "unavailable" };

const DEMO_SUBSCRIPTION_ID_PATTERN: RegExp = /^sub_demo_[a-z0-9_]{1,240}$/;

export async function setMyCancellation(
  subscriptionId: string,
  cancelAtPeriodEnd: boolean,
): Promise<SetMyCancellationResult> {
  if (process.env.NODE_ENV !== "development") {
    return { kind: "unavailable" };
  }

  if (
    typeof subscriptionId !== "string" ||
    !DEMO_SUBSCRIPTION_ID_PATTERN.test(subscriptionId) ||
    typeof cancelAtPeriodEnd !== "boolean"
  ) {
    return {
      kind: "error",
      message: "Invalid demo subscription request. Refresh the page and try again.",
    };
  }

  const message: string = cancelAtPeriodEnd
    ? "Demo only: cancellation would be scheduled for the end of the period. No backend or Stripe change was made."
    : "Demo only: the scheduled cancellation would be removed. No backend or Stripe change was made.";

  return { kind: "demo-success", message };
}
