import type { PipelinePolicy, PipelineRequest, PipelineResponse, SendRequest } from "@azure/core-rest-pipeline";
import { ResilienceTimeoutError, type AttemptContext, type ResilienceModuleOptions, type ResiliencePolicy, type ResilienceService } from "@nestjs/resilience";
import type { ConfigService } from "@nestjs/config";
import type { HttpTransport } from "../external-clients.js";

const TRANSIENT_HTTP: readonly number[] = [408, 429, 500, 502, 503, 504];

export class DependencyHttpError extends Error {
  public constructor(public readonly statusCode: number, public readonly retryAfterMs?: number) {
    super(`Upstream request failed (HTTP ${statusCode})`);
  }
}

export function isTransientDependencyError(error: unknown): boolean {
  if (error instanceof ResilienceTimeoutError) return true;
  if (typeof error !== "object" || error === null) return false;
  const record: Record<string, unknown> = error as Record<string, unknown>;
  const status: unknown = record.statusCode ?? record.status;
  if (typeof status === "number") return TRANSIENT_HTTP.includes(status);
  if (record.name === "TimeoutError") return true;
  const cause: Record<string, unknown> | undefined = typeof record.cause === "object" && record.cause !== null ? record.cause as Record<string, unknown> : undefined;
  const code: unknown = record.code ?? cause?.code;
  return (error instanceof TypeError && record.message === "fetch failed") ||
    (typeof code === "string" && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "REQUEST_SEND_ERROR"].includes(code));
}

export function reliabilityNumber(config: ConfigService, name: string, fallback: number, maximum: number = 2_147_483_647): number {
  const value: number = Number(config.get<string>(name, String(fallback)));
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid reliability setting: ${name}`);
  return value;
}

function backoff(attempt: number, error: unknown): number {
  if (error instanceof DependencyHttpError && error.retryAfterMs !== undefined) return error.retryAfterMs;
  return Math.floor(Math.random() * Math.min(200 * 2 ** (attempt - 1), 2000));
}

export function resilienceOptions(config: ConfigService): ResilienceModuleOptions {
  const presets: NonNullable<ResilienceModuleOptions["presets"]> = {};
  const concurrency: number = reliabilityNumber(config, "RESILIENCE_MAX_CONCURRENT", 10, 1000);
  const openDuration: number = reliabilityNumber(config, "RESILIENCE_OPEN_MS", 30_000);
  const attempts: number = reliabilityNumber(config, "RESILIENCE_READ_ATTEMPTS", 3, 5);
  const definitions: readonly [string, number][] = [
    ["github", 15_000], ["azure-devops", 10_000], ["azure-arm", 30_000],
    ["azure-monitor", 5_000], ["key-vault", 15_000], ["acr", 30_000], ["source-upload", 120_000],
  ];
  for (let definitionIndex: number = 0; definitionIndex < definitions.length; definitionIndex++) {
    const [dependency, timeout]: [string, number] = definitions[definitionIndex]!;
    const setting: string = dependency.toUpperCase().replaceAll("-", "_");
    const readTimeout: number = reliabilityNumber(config, `RESILIENCE_${setting}_TIMEOUT_MS`, timeout);
    for (let modeIndex: number = 0; modeIndex < 2; modeIndex++) {
      const mode: "read" | "write" = modeIndex === 0 ? "read" : "write";
      presets[`${dependency}-${mode}`] = {
        timeout: mode === "write" ? Math.max(readTimeout, 30_000) : readTimeout,
        retry: mode === "read" ? { attempts, backoff, retryIf: (error: unknown): boolean => isTransientDependencyError(error) && !(error instanceof DependencyHttpError && (error.retryAfterMs ?? 0) > 5000) } : false,
        circuitBreaker: { name: dependency, failureRateThreshold: 50, minimumCalls: 10,
          openDuration, slidingWindow: { type: "count", size: 20 }, recordIf: isTransientDependencyError },
        bulkhead: { name: dependency, maxConcurrent: concurrency, maxQueue: 10, queueTimeout: "1s" },
      };
    }
  }
  presets.cache = { timeout: reliabilityNumber(config, "RESILIENCE_CACHE_TIMEOUT_MS", 300), retry: false,
    circuitBreaker: { minimumCalls: 10, openDuration, recordIf: (): boolean => true },
    bulkhead: { maxConcurrent: concurrency, maxQueue: 0 } };
  return { presets };
}

function retryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds: number = Number(value);
  const duration: number = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(duration) ? Math.min(2_147_483_647, Math.max(0, duration)) : undefined;
}

function safeMethod(method: string): boolean { return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()); }

export function createResilientHttpTransport(http: HttpTransport, resilience: ResilienceService): HttpTransport {
  const policies: Map<string, ResiliencePolicy> = new Map<string, ResiliencePolicy>();
  const dependencies: readonly string[] = ["github", "azure-devops", "source-upload"];
  for (let dependencyIndex: number = 0; dependencyIndex < dependencies.length; dependencyIndex++) {
    const dependency: string = dependencies[dependencyIndex]!;
    policies.set(`${dependency}-read`, resilience.preset(`${dependency}-read`));
    policies.set(`${dependency}-write`, resilience.preset(`${dependency}-write`));
  }
  return async (input: Parameters<HttpTransport>[0], init?: Parameters<HttpTransport>[1]): Promise<Response> => {
    const url: URL = new URL(input instanceof Request ? input.url : String(input));
    const dependency: string = ["api.github.com", "codeload.github.com"].includes(url.hostname) ? "github"
      : url.hostname === "dev.azure.com" ? "azure-devops" : "source-upload";
    const method: string = init?.method ?? (input instanceof Request ? input.method : "GET");
    const parent: AbortSignal | undefined = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const policy: ResiliencePolicy = policies.get(`${dependency}-${safeMethod(method) ? "read" : "write"}`)!;
    return policy.execute(async ({ signal }: AttemptContext): Promise<Response> => {
      const requestSignal: AbortSignal = parent ? AbortSignal.any([signal, parent]) : signal;
      const response: Response = await http(input, { ...init, signal: requestSignal });
      if (TRANSIENT_HTTP.includes(response.status)) {
        const wait: number | undefined = retryAfter(response.headers.get("retry-after"));
        await response.body?.cancel().catch((): void => undefined);
        throw new DependencyHttpError(response.status, wait);
      }
      return response;
    }, { signal: parent, source: `${dependency}.${method.toUpperCase()}` });
  };
}

export function createAzureResiliencePolicy(resilience: ResilienceService, dependency: string): PipelinePolicy {
  const read: ResiliencePolicy = resilience.preset(`${dependency}-read`);
  const write: ResiliencePolicy = resilience.preset(`${dependency}-write`);
  return {
    name: `kumo-${dependency}-resilience`,
    async sendRequest(request: PipelineRequest, next: SendRequest): Promise<PipelineResponse> {
      const parent: AbortController = new AbortController();
      const abort: () => void = (): void => parent.abort();
      if (request.abortSignal?.aborted) parent.abort();
      request.abortSignal?.addEventListener("abort", abort);
      try {
        return await (safeMethod(request.method) ? read : write).execute(async ({ signal }: AttemptContext): Promise<PipelineResponse> => {
          const response: PipelineResponse = await next({ ...request, abortSignal: signal });
          if (TRANSIENT_HTTP.includes(response.status)) throw new DependencyHttpError(response.status, retryAfter(response.headers.get("retry-after")));
          return response;
        }, { signal: AbortSignal.any([parent.signal, AbortSignal.timeout(120_000)]), source: `${dependency}.${request.method}` });
      } finally { request.abortSignal?.removeEventListener("abort", abort); }
    },
  };
}
