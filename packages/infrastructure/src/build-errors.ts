import { ResilienceError } from "@nestjs/resilience";
import { BuildAccessDenied, BuildProviderError, InvalidBuildInput } from "@kumo/application";

function safeLabel(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(value)
    ? value : undefined;
}

export function describeBuildFailure(error: unknown): string {
  if (typeof error !== "object" || error === null) return "UnknownError";
  const name: string = safeLabel("name" in error ? error.name : undefined) ?? "Error";
  const code: string | undefined = safeLabel("code" in error ? error.code : undefined);
  const status: unknown = "statusCode" in error ? error.statusCode : undefined;
  const cause: unknown = "cause" in error ? error.cause : undefined;
  const causeCode: string | undefined = typeof cause === "object" && cause !== null && "code" in cause
    ? safeLabel(cause.code) : undefined;
  const details: string[] = [name];
  if (code) details.push(code);
  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) details.push(`HTTP ${status}`);
  if (causeCode && causeCode !== code) details.push(causeCode);
  return details.join(", ");
}

export async function runBuildStep<T>(stage: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (error instanceof ResilienceError) throw error;
    if (error instanceof InvalidBuildInput || error instanceof BuildAccessDenied || error instanceof BuildProviderError) throw error;
    throw new BuildProviderError(`${stage} failed (${describeBuildFailure(error)})`, { cause: error });
  }
}
