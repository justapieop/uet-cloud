import type { DefaultAzureCredential } from "@azure/identity";

export type AzureCredential = Pick<DefaultAzureCredential, "getToken">;
export type HttpTransport = typeof globalThis.fetch;

export const AZURE_CREDENTIAL: unique symbol = Symbol("AZURE_CREDENTIAL");
export const HTTP_TRANSPORT: unique symbol = Symbol("HTTP_TRANSPORT");
