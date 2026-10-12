import { Deployment, type DeploymentDetails } from "@kumo/domain";

const MAX_ERROR_MESSAGE_LENGTH: number = 1000;

export class DeploymentNotFoundError extends Error {
  public constructor(id: string) {
    super(`Deployment ${id} was not found`);
    this.name = "DeploymentNotFoundError";
  }
}

export function isAzureNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate: { statusCode?: unknown; code?: unknown } = error as {
    statusCode?: unknown;
    code?: unknown;
  };
  const code: string =
    typeof candidate.code === "string" ? candidate.code.toLowerCase() : "";

  return (
    candidate.statusCode === 404 ||
    code === "notfound" ||
    code === "resourcenotfound" ||
    code === "resourcegroupnotfound"
  );
}

export function sanitizeDeploymentError(error: unknown): string {
  const rawMessage: string =
    error instanceof Error ? error.message : "Azure operation failed";
  const redactedMessage: string = rawMessage
    .replace(/(authorization:\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:client[_ -]?secret|access[_ -]?token)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");

  return redactedMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

export function withDeploymentStatus(
  deployment: Deployment,
  status: DeploymentDetails["status"],
  errorMessage: string | null = null,
): Deployment {
  const details: DeploymentDetails = {
    id: deployment.id,
    userId: deployment.userId,
    name: deployment.name,
    status,
    spec: deployment.spec,
    fqdn: status === "DELETED" ? null : deployment.fqdn,
    errorMessage,
    createdAt: deployment.createdAt,
    updatedAt: new Date(),
  };

  return new Deployment(details);
}
