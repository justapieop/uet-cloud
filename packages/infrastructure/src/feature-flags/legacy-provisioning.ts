import type { FeatureFlagConfiguration } from "./provider.js";

export const LEGACY_PROVISIONING_FLAG: string = "LegacyPerUserProvisioning";

/** This platform-wide switch accepts only unconditional boolean feature flags. */
export function legacyProvisioningEnabled(configuration: FeatureFlagConfiguration): boolean {
  const matches: unknown[] = configuration.feature_flags.filter((flag: unknown): boolean =>
    typeof flag === "object" && flag !== null && "id" in flag && flag.id === LEGACY_PROVISIONING_FLAG);
  if (matches.length !== 1) return false;
  const flag: unknown = matches[0];
  if (typeof flag !== "object" || flag === null || !("enabled" in flag) || flag.enabled !== true ||
    "variants" in flag || "allocation" in flag) return false;
  if (!("conditions" in flag)) return true;
  const conditions: unknown = flag.conditions;
  if (typeof conditions !== "object" || conditions === null || Array.isArray(conditions)) return false;
  if ("requirement_type" in conditions && conditions.requirement_type !== "Any") return false;
  return !("client_filters" in conditions) || (Array.isArray(conditions.client_filters) && conditions.client_filters.length === 0);
}
