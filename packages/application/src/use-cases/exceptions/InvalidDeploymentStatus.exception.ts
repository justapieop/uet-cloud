export class InvalidDeploymentStatusError extends Error {
  public constructor(message?: string) {
    super(message);
  }
}
