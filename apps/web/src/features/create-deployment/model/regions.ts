import type { components } from "@kumo/rest";

export type DeploymentRegion = components["schemas"]["DeploymentRegionResponseDto"];
export type RegionsResult =
  | { readonly data: DeploymentRegion[]; readonly error?: never }
  | { readonly error: string; readonly data?: never };
