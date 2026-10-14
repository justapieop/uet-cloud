import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";

export interface DeleteDeploymentInput {
  id: string;
  userId: string;
}

export class DeleteDeploymentCase {
  public constructor(
    private readonly uow: UnitOfWork,
  ) { }
  
  public exec(input: DeleteDeploymentInput): Promise<void> {
    return this.uow.run((repo: UnitOfWorkRepositories) => this.deleteDeployment(repo, input));
  }

  private async deleteDeployment(repo: UnitOfWorkRepositories, input: DeleteDeploymentInput): Promise<void> {
    await repo.deployment.delete(input.id, input.userId);
  }
}
