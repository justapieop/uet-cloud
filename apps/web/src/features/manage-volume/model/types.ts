import type { components } from "@kumo/rest";

export type DeploymentVolume = components["schemas"]["DeploymentVolumeResponseDto"];
export type AttachVolumeInput = components["schemas"]["DeploymentVolumeDto"];

export interface VolumeActionResult {
  readonly success: boolean;
  readonly error?: string;
}

export const VOLUME_NAME_REGEX: RegExp = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;
export const MOUNT_PATH_REGEX: RegExp = /^\/[a-zA-Z0-9_./-]+$/;
