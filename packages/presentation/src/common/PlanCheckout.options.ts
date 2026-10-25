import type { PlanCheckoutRedirects } from "@kumo/application";

export function createPlanCheckoutRedirects(frontendUrl: string): PlanCheckoutRedirects {
  const destination: URL = new URL(frontendUrl);
  if (!["http:", "https:"].includes(destination.protocol) || destination.username || destination.password) {
    throw new Error("FRONTEND_URL must be an HTTP(S) URL without credentials");
  }
  destination.pathname = `${destination.pathname.replace(/\/$/, "")}/dashboard`;
  destination.search = "";
  destination.hash = "";
  // Both outcomes return to the existing dashboard; a redirect never grants access.
  return { successUrl: destination.href, cancelUrl: destination.href };
}
