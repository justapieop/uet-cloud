export function normalizeAzureRegion(region: string): string {
  return region.replace(/\s+/g, "").toLowerCase();
}
