import type { PipelinePolicy, PipelineRequest, PipelineResponse, SendRequest } from "@azure/core-rest-pipeline";
import type { AzureCredential } from "../external-clients.js";

export interface ConfigurationDiagnostic {
  readonly dependency: "app-configuration" | "key-vault" | "azure-identity";
  readonly event: "http-failure" | "request-failure" | "credential-failure" | "credential-selected";
  readonly statusCode?: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly category?: "ip-address-rejected" | "nsp-rejected";
  readonly principalId?: string;
  readonly tenantId?: string;
}

type DiagnosticSink = (event: ConfigurationDiagnostic) => void;
const GUID: RegExp = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const ERROR_CODES: readonly string[] = ["ENOTFOUND", "ENOENT", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "REQUEST_SEND_ERROR", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "AuthenticationRequiredError", "AggregateAuthenticationError", "CredentialUnavailableError", "AuthenticationError"];

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = "code" in error ? error.code : undefined;
  const name: unknown = "name" in error ? error.name : undefined;
  if (typeof code === "string" && ERROR_CODES.includes(code)) return code;
  return typeof name === "string" && ERROR_CODES.includes(name) ? name : undefined;
}

function emit(sink: DiagnosticSink, event: ConfigurationDiagnostic): void {
  try { sink(event); } catch { /* Diagnostics must not change the SDK result. */ }
}

export function configurationDiagnosticsPolicy(dependency: "app-configuration" | "key-vault", sink: DiagnosticSink): PipelinePolicy {
  return {
    name: `kumo-${dependency}-diagnostics`,
    sendRequest: async (request: PipelineRequest, next: SendRequest): Promise<PipelineResponse> => {
      let response: PipelineResponse;
      try { response = await next(request); }
      catch (error: unknown) {
        const status: unknown = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
        emit(sink, { dependency, event: "request-failure", code: errorCode(error),
          statusCode: typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined });
        throw error;
      }
      if (response.status >= 400) {
        const requestId: string | undefined = response.headers.get("x-ms-request-id");
        let category: ConfigurationDiagnostic["category"];
        // Read only known network-error categories, never log response bodies.
        if (response.status === 403 && response.bodyAsText && response.bodyAsText.length <= 8192) {
          try {
            const problem: unknown = JSON.parse(response.bodyAsText);
            if (typeof problem === "object" && problem !== null && "type" in problem) {
              if (problem.type === "https://azconfig.io/errors/ip-address-rejected") category = "ip-address-rejected";
              if (problem.type === "https://azconfig.io/errors/nsp-rejected") category = "nsp-rejected";
            }
          } catch { /* The response need not contain JSON. */ }
        }
        emit(sink, { dependency, event: "http-failure", statusCode: response.status,
          requestId: requestId && GUID.test(requestId) ? requestId : undefined, category });
      }
      return response;
    },
  };
}

export function configurationDiagnosticCredential(credential: AzureCredential, sink: DiagnosticSink): AzureCredential {
  let reported: boolean = false;
  return { getToken: async (...args: Parameters<AzureCredential["getToken"]>): ReturnType<AzureCredential["getToken"]> => {
    let access: Awaited<ReturnType<AzureCredential["getToken"]>>;
    try { access = await credential.getToken(...args); }
    catch (error: unknown) {
      emit(sink, { dependency: "azure-identity", event: "credential-failure", code: errorCode(error) });
      throw error;
    }
    if (!reported) {
      reported = true;
      let principalId: string | undefined;
      let tenantId: string | undefined;
      try {
        // Inspect metadata only; this is not token validation or authorization.
        const claims: unknown = JSON.parse(Buffer.from(access.token.split(".")[1] ?? "", "base64url").toString("utf8"));
        if (typeof claims === "object" && claims !== null) {
          if ("oid" in claims && typeof claims.oid === "string" && GUID.test(claims.oid)) principalId = claims.oid;
          if ("tid" in claims && typeof claims.tid === "string" && GUID.test(claims.tid)) tenantId = claims.tid;
        }
      } catch { /* Azure can issue opaque tokens; never require JWT metadata. */ }
      emit(sink, { dependency: "azure-identity", event: "credential-selected", principalId, tenantId });
    }
    return access;
  } };
}
