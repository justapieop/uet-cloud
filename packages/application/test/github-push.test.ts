import assert from "node:assert/strict";
import { test } from "node:test";
import { Deployment, Plan, User, type DeploymentSpec, type DeploymentStatus } from "@kumo/domain";
import {
  ProcessGitHubPushCase, RedeployDeploymentCase, InvalidGitHubWebhook, SubscriptionCheckUnavailable,
  type GitHubPush, type UnitOfWork, type UnitOfWorkRepositories,
} from "../dist/index.js";
import { AdmissionFixture, PLAN, SPEC } from "./support/admission.ts";

const PUSH: Readonly<Record<string, unknown>> = {
  deleted: false, ref: "refs/heads/main", after: "a".repeat(40),
  installation: { id: 456 }, repository: { id: 789, name: "repo", owner: { id: 123, login: "owner" } },
  sender: { id: 999 },
};

function deployment(id: string, spec: DeploymentSpec = SPEC, userId: string = "123", status: DeploymentStatus = "RUNNING"): Deployment {
  return new Deployment({ id, userId, name: "my-app", status, spec, resourceId: `/resource/${id}` });
}

class PushFixture extends AdmissionFixture {
  public allowed: boolean = true;
  public installed: boolean = true;
  public checks: number = 0;
  public failure: boolean = false;
  public readonly push: ProcessGitHubPushCase;

  public constructor() {
    super();
    this.plans = [new Plan({ ...PLAN, deployments: 20 })];
    this.deployments = [deployment("one")];
    const scoped: UnitOfWork = { run: <T>(work: (repositories: UnitOfWorkRepositories) => Promise<T>): Promise<T> => this.run(
      (repositories: UnitOfWorkRepositories): Promise<T> => work({ ...repositories, deployment: {
        ...repositories.deployment,
        findByUserId: async (userId: string): Promise<Deployment[]> => {
          assert.equal(userId, "123");
          // Include a foreign row to prove the use case still rejects it defensively.
          return this.deployments;
        },
      } }),
    ) };
    this.push = new ProcessGitHubPushCase(scoped, {
      inspectPushRepository: async (push: GitHubPush): Promise<{ defaultBranch: string } | null> => {
        this.checks++; assert.equal(push.ownerId, "123");
        if (this.failure) throw new Error("GitHub unavailable");
        return this.installed ? { defaultBranch: "main" } : null;
      },
    }, new RedeployDeploymentCase(this, this), { exec: async (): Promise<boolean> => this.allowed });
  }
}

test("push queues only deployments owned by the repository account and matching the configured branch", async (): Promise<void> => {
  const setup: PushFixture = new PushFixture();
  setup.deployments = [
    deployment("default"), deployment("fragment", { ...SPEC, repo: "git@github.com:OWNER/REPO.git#main" }),
    deployment("explicit", { ...SPEC, ref: "refs/heads/main" }),
    deployment("feature", { ...SPEC, ref: "feature" }), deployment("different-repo", { ...SPEC, repo: "https://github.com/owner/other" }),
    deployment("different-owner", { ...SPEC, repo: "https://github.com/another/repo" }),
    deployment("foreign", SPEC, "999"), deployment("stopped", SPEC, "123", "STOPPED"),
    deployment("busy", SPEC, "123", "PROVISIONING"), deployment("pinned", { ...SPEC, ref: "b".repeat(40) }),
  ];
  assert.equal(await setup.push.exec("push", PUSH), "123");
  assert.deepEqual(setup.deployments.filter((item: Deployment): boolean => item.status === "PENDING").map((item: Deployment): string => item.id), ["default", "fragment", "explicit"]);
  assert.equal(setup.receipts.size, 3);
});

test("duplicate concurrent push deliveries queue once and completed work is protected by the durable receipt", async (): Promise<void> => {
  const setup: PushFixture = new PushFixture();
  await Promise.all([setup.push.exec("push", PUSH), setup.push.exec("push", PUSH)]);
  assert.equal(setup.receipts.size, 1);
  assert.equal(setup.deployments[0]?.status, "PENDING");
  setup.deployments = [new Deployment({ ...setup.deployments[0]!.getDetails(), status: "RUNNING" })];
  const calls: number = setup.stripeCalls;
  await setup.push.exec("push", PUSH);
  assert.equal(setup.stripeCalls, calls);
  assert.equal(setup.deployments[0]?.status, "RUNNING");
  assert.equal(setup.receipts.size, 1);
  await setup.push.exec("push", { ...PUSH, after: "c".repeat(40) });
  assert.equal(setup.deployments[0]?.status, "PENDING");
  assert.equal(setup.receipts.size, 2);
  setup.deployments = [new Deployment({ ...setup.deployments[0]!.getDetails(), status: "RUNNING" })];
  await setup.push.exec("push", { ...PUSH, before: "c".repeat(40), forced: true });
  assert.equal(setup.deployments[0]?.status, "PENDING");
  assert.equal(setup.receipts.size, 3, "A new force-push to an older commit is a new event");
});

test("push does not bypass user eligibility, permissions, current installation ownership, or subscription checks", async (): Promise<void> => {
  const variants: string[] = ["inactive", "suspended", "permission", "installation", "subscription", "quota"];
  for (let index: number = 0; index < variants.length; index++) {
    const setup: PushFixture = new PushFixture();
    const variant: string = variants[index]!;
    if (variant === "inactive") setup.user = new User({ ...setup.user, active: false });
    if (variant === "suspended") setup.user = new User({ ...setup.user, suspended: true });
    if (variant === "permission") setup.allowed = false;
    if (variant === "installation") setup.installed = false;
    if (variant === "subscription") setup.products = [];
    if (variant === "quota") setup.plans = [];
    assert.equal(await setup.push.exec("push", PUSH), null, variant);
    assert.equal(setup.deployments[0]?.status, "RUNNING", variant);
    assert.equal(setup.receipts.size, 0, variant);
  }
});

test("non-push events, deleted refs, tags and malformed push data cannot schedule a rebuild", async (): Promise<void> => {
  const setup: PushFixture = new PushFixture();
  await assert.rejects(setup.push.exec("ping", {}), InvalidGitHubWebhook);
  assert.equal(await setup.push.exec("push", { ...PUSH, deleted: true, after: "0".repeat(40) }), null);
  assert.equal(await setup.push.exec("push", { ...PUSH, ref: "refs/tags/v1" }), null);
  await assert.rejects(setup.push.exec("push", {}), InvalidGitHubWebhook);
  await assert.rejects(setup.push.exec("push", { ...PUSH, installation: { id: -1 } }), InvalidGitHubWebhook);
  assert.equal(setup.checks, 0);
  assert.equal(setup.receipts.size, 0);
});

test("provider failures and receipt-write failures propagate and leave unaccepted deployments unchanged", async (): Promise<void> => {
  const setup: PushFixture = new PushFixture();
  setup.failure = true;
  await assert.rejects(setup.push.exec("push", PUSH), /GitHub unavailable/);
  setup.failure = false;
  setup.receiptFailure = true;
  await assert.rejects(setup.push.exec("push", PUSH), /Receipt persistence/);
  assert.equal(setup.deployments[0]?.status, "RUNNING");
  assert.equal(setup.receipts.size, 0);
});

test("partial push fan-out can be redelivered without rebuilding already accepted apps twice", async (): Promise<void> => {
  const setup: PushFixture = new PushFixture();
  setup.deployments = [deployment("one"), deployment("two")];
  const original: (customerId: string) => Promise<readonly string[]> = setup.getActiveSubscriptionProductIds.bind(setup);
  let lookups: number = 0;
  setup.getActiveSubscriptionProductIds = (customerId: string): Promise<readonly string[]> => {
    lookups++;
    if (lookups === 2) throw new SubscriptionCheckUnavailable("Billing unavailable");
    return original(customerId);
  };
  await assert.rejects(setup.push.exec("push", PUSH), /Billing unavailable/);
  assert.equal(setup.receipts.size, 1);
  assert.equal(setup.deployments[0]?.status, "PENDING");
  assert.equal(setup.deployments[1]?.status, "RUNNING");
  await setup.push.exec("push", PUSH);
  assert.equal(setup.receipts.size, 2);
  assert.ok(setup.deployments.every((item: Deployment): boolean => item.status === "PENDING"));
});
