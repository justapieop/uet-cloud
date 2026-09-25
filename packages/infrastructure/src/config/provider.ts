import { load, LabelFilter, type AzureAppConfiguration } from "@azure/app-configuration-provider";
import { DefaultAzureCredential } from "@azure/identity";
import type { DynamicModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { parse } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

async function loadAzureConfiguration(): Promise<Record<string, unknown>> {
  const endpoint: string | undefined = process.env.AZURE_APPCONFIG_ENDPOINT ?? bootstrapSettings.AZURE_APPCONFIG_ENDPOINT;

  if (!endpoint) {
    throw new Error("AZURE_APPCONFIG_ENDPOINT is required when using Azure configuration");
  }

  const credential: DefaultAzureCredential = new DefaultAzureCredential();
  const configuration: AzureAppConfiguration = await load(endpoint, credential, {
    selectors: [
      { keyFilter: "*", labelFilter: LabelFilter.Null },
      { keyFilter: "*", labelFilter: environment },
    ],
    keyVaultOptions: { credential },
  });

  return configuration.constructConfigurationObject();
}

const environment: string = process.env.NODE_ENV ?? "production";
const envFilePath: string = fileURLToPath(new URL("../../../../.env", import.meta.url));
const bootstrapSettings: Record<string, string> = existsSync(envFilePath)
  ? parse(readFileSync(envFilePath))
  : {};
const configurationSource: string = process.env.KUMO_CONFIG_SOURCE ?? bootstrapSettings.KUMO_CONFIG_SOURCE ?? "azure";

if (!["development", "test", "production"].includes(environment)) {
  throw new Error(`Unsupported NODE_ENV: ${environment}`);
}

if (!["local", "azure"].includes(configurationSource)) {
  throw new Error(`Unsupported KUMO_CONFIG_SOURCE: ${configurationSource}`);
}

const useAzureConfiguration: boolean = configurationSource === "azure";

export const configModule: Promise<DynamicModule> = ConfigModule.forRoot({
  cache: true,
  expandVariables: false,
  isGlobal: true,
  ignoreEnvFile: useAzureConfiguration,
  envFilePath,
  load: useAzureConfiguration ? [loadAzureConfiguration] : [],
});
