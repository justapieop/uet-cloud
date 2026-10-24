import type { DeploymentRegion, DeploymentRegionsReader } from "../../ports/deployment-regions.js";

export class GetDeploymentRegionsCase {
  public constructor(private readonly reader: DeploymentRegionsReader) {}

  public exec(): Promise<DeploymentRegion[]> {
    return this.reader.list();
  }
}
