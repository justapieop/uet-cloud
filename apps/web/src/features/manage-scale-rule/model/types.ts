import type { components } from "@kumo/rest";

export type ScaleRule = components["schemas"]["ScaleRuleResponseDto"];
export type ScaleRuleInput = components["schemas"]["CreateScaleRuleDto"];
export type ScaleRuleResult = { readonly success: boolean; readonly error?: string };
