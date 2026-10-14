export class DeploymentNotFound extends Error {
  public constructor(message?: string) {
    super(message);
  }
}