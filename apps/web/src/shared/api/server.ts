import "server-only";

import { getClient, setBaseUrl, type OpenApiClient } from "@kumo/rest";
import { API_URL } from "@/shared/config";

setBaseUrl(API_URL);

export const apiClient: OpenApiClient = getClient();
