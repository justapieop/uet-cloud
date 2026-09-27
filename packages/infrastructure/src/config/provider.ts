import { load, LabelFilter, type AzureAppConfiguration } from "@azure/app-configuration-provider";
import { DefaultAzureCredential } from "@azure/identity";
import type { DynamicModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { parse } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FEATURE_FLAGS, type FeatureFlagConfiguration } from "./feature-flags.js";

async function loadAzureConfigurationProvider(): Promise<AzureAppConfiguration> {
  const endpoint: string | undefined = process.env.AZURE_APPCONFIG_ENDPOINT ?? bootstrapSettings.AZURE_APPCONFIG_ENDPOINT;

  if (!endpoint) {
    throw new Error("AZURE_APPCONFIG_ENDPOINT is required when using Azure configuration");
  }

  const credential: DefaultAzureCredential = new DefaultAzureCredential();
  return load(endpoint, credential, {
    selectors: [
      { keyFilter: "*", labelFilter: LabelFilter.Null },
      { keyFilter: "*", labelFilter: environment },
    ],
    featureFlagOptions: {
      enabled: true,
      selectors: [
        { keyFilter: "*", labelFilter: LabelFilter.Null },
        { keyFilter: "*", labelFilter: environment },
      ],
    },
    keyVaultOptions: { credential, },
  });
}

const envFilePath: string = fileURLToPath(new URL("../../../../.env", import.meta.url));
const bootstrapSettings: Record<string, string> = existsSync(envFilePath)
  ? parse(readFileSync(envFilePath))
  : {};
const environment: string = process.env.NODE_ENV ?? bootstrapSettings.NODE_ENV ?? "production";
const configurationSource: string = process.env.CONFIG_SOURCE ?? bootstrapSettings.CONFIG_SOURCE ?? "azure";

if (!["development", "test", "production"].includes(environment)) {
  throw new Error(`Unsupported NODE_ENV: ${environment}`);
}

if (!["local", "azure"].includes(configurationSource)) {
  throw new Error(`Unsupported CONFIG_SOURCE: ${configurationSource}`);
}

const useAzureConfiguration: boolean = configurationSource === "azure";
let azureConfigurationPromise: Promise<AzureAppConfiguration> | undefined;

function getAzureConfiguration(): Promise<AzureAppConfiguration> {
  azureConfigurationPromise ??= loadAzureConfigurationProvider();
  return azureConfigurationPromise;
}

async function loadAzureConfiguration(): Promise<Record<string, unknown>> {
  const configuration: AzureAppConfiguration = await getAzureConfiguration();
  const values: Record<string, unknown> = configuration.constructConfigurationObject();
  delete values.feature_management;
  return values;
}

async function loadFeatureFlags(): Promise<FeatureFlagConfiguration> {
  if (!useAzureConfiguration) {
    return { feature_flags: [] };
  }

  const configuration: AzureAppConfiguration = await getAzureConfiguration();
  const featureManagement: unknown = configuration.get("feature_management");

  if (typeof featureManagement !== "object" || featureManagement === null ||
    !("feature_flags" in featureManagement) ||
    !Array.isArray(featureManagement.feature_flags)) {
    throw new Error("Azure App Configuration did not return feature flags");
  }

  return { feature_flags: featureManagement.feature_flags };
}

function loadRuntimeConfiguration(): Record<string, string> {
  return {
    NODE_ENV: environment,
    CONFIG_SOURCE: configurationSource,
  };
}

async function createAppConfigModule(): Promise<DynamicModule> {
  const configModule: DynamicModule = await ConfigModule.forRoot({
    cache: true,
    expandVariables: false,
    isGlobal: true,
    ignoreEnvFile: useAzureConfiguration,
    envFilePath,
    load: useAzureConfiguration
      ? [loadAzureConfiguration, loadRuntimeConfiguration]
      : [loadRuntimeConfiguration],
  });

  return {
    ...configModule,
    providers: [
      ...(configModule.providers ?? []),
      { provide: FEATURE_FLAGS, useFactory: loadFeatureFlags },
    ],
    exports: [...(configModule.exports ?? []), FEATURE_FLAGS],
  };
}

export const AppConfigModule: Promise<DynamicModule> = createAppConfigModule();
