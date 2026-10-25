import { createHash } from "node:crypto";
import { Permission, type Deployment, type User } from "@kumo/domain";
import { parseGitHubRepository, type GitHubRepository } from "../../github-repository.js";
import { InvalidGitHubWebhook, type GitHubPush, type GitHubWebhookRepositoryGateway } from "../../ports/github-webhook.js";
import { DeploymentNotFoundError } from "../../ports/deployment.js";
import { DeploymentQuotaExceeded, DeploymentSubscriptionRequired } from "../../ports/stripe.js";
import type { UnitOfWork, UnitOfWorkRepositories } from "../../ports/uow.js";
import type { CheckPermissionsCase } from "../role/CheckPermissions.case.js";
import { InvalidDeploymentStatusError } from "../exceptions/InvalidDeploymentStatus.exception.js";
import type { RedeployDeploymentCase } from "./RedeployDeployment.case.js";

export class ProcessGitHubPushCase {
  public constructor(
    private readonly uow: UnitOfWork,
    private readonly github: GitHubWebhookRepositoryGateway,
    private readonly redeploy: Pick<RedeployDeploymentCase, "exec">,
    private readonly permissions: Pick<CheckPermissionsCase, "exec">,
  ) {}

  /** Called only after raw-body signature verification. Returns the affected owner for cache invalidation. */
  public async exec(event: string, payload: unknown): Promise<string | null> {
    if (event !== "push") throw new InvalidGitHubWebhook("Only GitHub push webhooks are supported");
    const push: GitHubPush | null = parsePush(payload);
    if (!push) return null;
    const deployments: Deployment[] = await this.uow.run(async (repo: UnitOfWorkRepositories): Promise<Deployment[]> => {
      const user: User | null = await repo.users.findById(push.ownerId);
      if (!user || user.id !== push.ownerId || !user.active || user.suspended) return [];
      return repo.deployment.findByUserId(user.id);
    });
    if (deployments.length === 0 || !await this.permissions.exec(push.ownerId, [Permission.DeploymentUpdate])) return null;
    const current: { readonly defaultBranch: string } | null = await this.github.inspectPushRepository(push);
    if (!current) return null;
    // Delivery headers are not signed. Use the verified body for persistent
    // replay protection, including push metadata so a later force-push back
    // to a previously deployed commit is not mistaken for a redelivery.
    const key: string = `github-push:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
    let affected: boolean = false;
    for (let index: number = 0; index < deployments.length; index++) {
      const deployment: Deployment = deployments[index]!;
      if (deployment.userId !== push.ownerId || !deployment.spec || !deployment.resourceId
        || !["RUNNING", "FAILED"].includes(deployment.status)) continue;
      let repository: GitHubRepository;
      try { repository = parseGitHubRepository(deployment.spec.repo); }
      catch { continue; }
      if (repository.owner.toLowerCase() !== push.owner.toLowerCase() || repository.name.toLowerCase() !== push.name.toLowerCase()) continue;
      const configured: string = deployment.spec.ref ?? repository.ref ?? "HEAD";
      if (configured.startsWith("refs/tags/") || /^[a-f0-9]{40}$/i.test(configured)) continue;
      const branch: string = configured === "HEAD" ? current.defaultBranch : configured.replace(/^refs\/heads\//, "");
      if (push.ref !== `refs/heads/${branch}`) continue;
      try {
        await this.redeploy.exec(deployment.id, push.ownerId, key);
        affected = true;
      } catch (error: unknown) {
        // Infrastructure failures propagate so partial fan-out can be redelivered safely.
        if (error instanceof DeploymentNotFoundError || error instanceof DeploymentSubscriptionRequired
          || error instanceof DeploymentQuotaExceeded || error instanceof InvalidDeploymentStatusError) continue;
        throw error;
      }
    }
    return affected ? push.ownerId : null;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parsePush(payload: unknown): GitHubPush | null {
  if (!record(payload) || typeof payload.deleted !== "boolean" || typeof payload.ref !== "string"
    || typeof payload.after !== "string" || !/^[a-f0-9]{40}$/i.test(payload.after) || !record(payload.repository) || !record(payload.repository.owner)
    || !record(payload.installation) || !positiveId(payload.installation.id) || !positiveId(payload.repository.id)
    || !positiveId(payload.repository.owner.id) || typeof payload.repository.owner.login !== "string"
    || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(payload.repository.owner.login)
    || typeof payload.repository.name !== "string" || !/^[a-zA-Z0-9._-]{1,100}$/.test(payload.repository.name)
    || payload.repository.name === "." || payload.repository.name === "..") throw new InvalidGitHubWebhook("Invalid GitHub push payload");
  if (payload.deleted || /^0{40}$/.test(payload.after) || !payload.ref.startsWith("refs/heads/")) return null;
  return { repositoryId: payload.repository.id, ownerId: String(payload.repository.owner.id), owner: payload.repository.owner.login,
    name: payload.repository.name, installationId: payload.installation.id, ref: payload.ref, after: payload.after.toLowerCase() };
}
