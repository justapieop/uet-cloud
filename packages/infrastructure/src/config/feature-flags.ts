export interface FeatureFlagConfiguration {
  readonly feature_flags: ReadonlyArray<unknown>;
}

export const FEATURE_FLAGS: unique symbol = Symbol("FEATURE_FLAGS");
