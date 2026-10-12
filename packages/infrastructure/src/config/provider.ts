import { load, LabelFilter, type AzureAppConfiguration } from "@azure/app-configuration-provider";
import { DefaultAzureCredential } from "@azure/identity";
import { parse } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FEATURE_FLAG_REFRESH_INTERVAL_MS } from "../feature-flags/interval.js";

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
      refresh: {
        enabled: true,
        refreshIntervalInMs: FEATURE_FLAG_REFRESH_INTERVAL_MS,
      },
    },
    keyVaultOptions: { credential, },
  });
}

export const envFilePath: string = fileURLToPath(new URL("../../../../.env", import.meta.url));
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

export const useAzureConfiguration: boolean = configurationSource === "azure";
let azureConfigurationPromise: Promise<AzureAppConfiguration> | undefined;

export function getAzureConfiguration(): Promise<AzureAppConfiguration> {
  azureConfigurationPromise ??= loadAzureConfigurationProvider();
  return azureConfigurationPromise;
}

export async function loadAzureConfiguration(): Promise<Record<string, unknown>> {
  const configuration: AzureAppConfiguration = await getAzureConfiguration();
  const values: Record<string, unknown> = configuration.constructConfigurationObject();
  delete values.feature_management;
  return values;
}

export function loadRuntimeConfiguration(): Record<string, string> {
  return {
    NODE_ENV: environment,
    CONFIG_SOURCE: configurationSource,
  };
}
