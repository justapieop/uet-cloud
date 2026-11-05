import { Deployment, type DeploymentDetails } from "@kumo/domain";
import { BuildAccessDenied, BuildProviderError, InvalidBuildInput } from "../../ports/build.js";
import { DeploymentProgressConflictError, type DeploymentProgressOptions, type DeploymentProvisioner, type DeploymentProvisionResult, type DeploymentRepository } from "../../ports/deployment.js";

export class ProcessDeploymentCase {
  public constructor(private readonly repository: DeploymentRepository, private readonly provisioner: DeploymentProvisioner) {}

  public async exec(deployment: Deployment): Promise<void> {
    if (deployment.status !== "PROVISIONING" || !deployment.spec) throw new Error("Deployment must be claimed and have a creation request");
    const progressOptions: DeploymentProgressOptions = { expectedStatus: "PROVISIONING" };
    let details: DeploymentDetails = deployment.getDetails();
    try {
      const result: DeploymentProvisionResult = await this.provisioner.provisionDeployment({
        id: deployment.id, userId: deployment.userId, name: deployment.name, spec: deployment.spec, resourceId: deployment.resourceId ?? undefined,
      }, async (buildId: string, image: string): Promise<void> => {
        details = { ...details, buildId, image, updatedAt: new Date() };
        await this.repository.updateProgress(new Deployment(details), progressOptions);
      });
      await this.repository.updateProgress(new Deployment({ ...details, ...result, status: "RUNNING", error: null, updatedAt: new Date() }), progressOptions);
    } catch (error: unknown) {
      if (error instanceof DeploymentProgressConflictError) return;
      const message: string = error instanceof BuildProviderError || error instanceof BuildAccessDenied || error instanceof InvalidBuildInput
        ? error.message.slice(0, 1000) : "Deployment provisioning failed";
      try {
        await this.repository.updateProgress(new Deployment({ ...details, status: "FAILED", error: message, updatedAt: new Date() }), progressOptions);
      } catch (saveError: unknown) {
        if (!(saveError instanceof DeploymentProgressConflictError)) throw saveError;
      }
    }
  }
}
