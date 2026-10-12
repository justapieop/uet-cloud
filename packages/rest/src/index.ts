import createClient, { type Client } from "openapi-fetch";
import type { paths } from "./schema.js";

export * from "./schema.js";

export type OpenApiClient = Client<paths, `${string}/${string}`>;

let openApiClient: OpenApiClient;

export function setBaseUrl(baseUrl: string): void {
  openApiClient = createClient<paths>({ baseUrl, });
}

export function getClient(): OpenApiClient {
  return openApiClient;
}