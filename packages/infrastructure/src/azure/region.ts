export enum AzureRegions {
  EastUs = "eastus",
  CentralUs = "centralus",
  Sea = "southeastasia",
}

export const DEFAULT_REGION: AzureRegions = AzureRegions.Sea;

export function normalizeAzureRegion(region: string): string {
  return region.replace(/\s+/g, "").toLowerCase();
}
