import { Logger, type OnModuleDestroy, type OnModuleInit, type FactoryProvider, type ExistingProvider } from "@nestjs/common";
import type { AzureAppConfiguration } from "@azure/app-configuration-provider";
import { getAzureConfiguration, useAzureConfiguration } from "../config/provider.js";
import { FEATURE_FLAG_REFRESH_INTERVAL_MS } from "./interval.js";

export interface FeatureFlagConfiguration {
  readonly feature_flags: ReadonlyArray<unknown>;
}

export const FEATURE_FLAGS: unique symbol = Symbol("FEATURE_FLAGS");

function readFeatureFlags(configuration: AzureAppConfiguration): ReadonlyArray<unknown> {
  const featureManagement: unknown = configuration.get("feature_management");

  if (typeof featureManagement !== "object" || featureManagement === null ||
    !("feature_flags" in featureManagement) ||
    !Array.isArray(featureManagement.feature_flags)) {
    throw new Error("Azure App Configuration did not return feature flags");
  }

  return featureManagement.feature_flags;
}

export class FeatureFlagsService implements FeatureFlagConfiguration, OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger = new Logger(FeatureFlagsService.name);
  private readonly configuration: AzureAppConfiguration | null;
  private currentFlags: ReadonlyArray<unknown>;
  private timer: NodeJS.Timeout | null = null;
  private refreshInProgress: Promise<void> | null = null;

  public constructor(configuration: AzureAppConfiguration | null) {
    this.configuration = configuration;
    this.currentFlags = configuration === null ? [] : readFeatureFlags(configuration);
  }

  public get feature_flags(): ReadonlyArray<unknown> {
    return this.currentFlags;
  }

  public onModuleInit(): void {
    if (this.configuration === null) {
      return;
    }

    this.timer = setInterval((): void => {
      void this.refresh().catch((error: unknown): void => {
        this.logger.warn("Feature flag refresh failed; retaining the last known flags", error);
      });
    }, FEATURE_FLAG_REFRESH_INTERVAL_MS);
    this.timer.unref();
  }

  public onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async refresh(): Promise<void> {
    const configuration: AzureAppConfiguration | null = this.configuration;
    if (configuration === null) {
      return;
    }

    if (this.refreshInProgress !== null) {
      return this.refreshInProgress;
    }

    const operation: Promise<void> = this.refreshFromAzure(configuration);
    this.refreshInProgress = operation;
    try {
      await operation;
    } finally {
      this.refreshInProgress = null;
    }
  }

  private async refreshFromAzure(configuration: AzureAppConfiguration): Promise<void> {
    await configuration.refresh();
    this.currentFlags = readFeatureFlags(configuration);
  }
}

export const featureFlagsProvider: FactoryProvider<FeatureFlagsService> = {
  provide: FeatureFlagsService,
  useFactory: async (): Promise<FeatureFlagsService> => new FeatureFlagsService(
    useAzureConfiguration ? await getAzureConfiguration() : null,
  ),
};

export const featureFlagsTokenProvider: ExistingProvider<FeatureFlagsService> = {
  provide: FEATURE_FLAGS,
  useExisting: FeatureFlagsService,
};
