import type { JSX } from "react";
import type { Plan } from "@/entities/plan";
import { getUserPlan, type UserPlanResult } from "@/entities/plan/server";
import { getDeployments, type DeploymentsResult } from "@/entities/deployment/server";
import { CancellationControl } from "@/features/manage-own-subscription";
import {
  getMySubscriptions,
  type CustomerSubscription,
  type MySubscriptionsResult,
} from "@/entities/subscription";
import { Navbar } from "@/widgets/navbar";

interface PlanContentProps {
  readonly result: UserPlanResult;
}

interface AccountUsageContentProps {
  readonly planResult: UserPlanResult;
  readonly deploymentsResult: DeploymentsResult;
}

interface SubscriptionContentProps {
  readonly result: MySubscriptionsResult;
}

function formatCancellationDate(timestamp: number | null): string {
  if (timestamp === null) return "At period end";

  const date: Date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return `${new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date)} UTC`;
}

function PlanContent({ result }: PlanContentProps): JSX.Element {
  if (result.kind === "forbidden" || result.kind === "unavailable") {
    return (
      <div role="alert" className="m-5 rounded-lg border border-red-400/15 bg-red-400/5 p-5">
        <p className="text-sm text-red-200">Your plan information could not be loaded.</p>
        <a href="/account/billing" className="mt-3 inline-block text-sm text-blue-300 hover:text-blue-200">
          Try again
        </a>
      </div>
    );
  }

  if (!result.data.has_plan) {
    return (
      <div className="p-5">
        <h3 className="text-sm font-medium">No active plan</h3>
        <p className="mt-2 text-sm leading-6 text-muted-text">
          Choose a plan to start deploying applications.
        </p>
        <a
          href="/plans"
          className="mt-4 inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          Browse plans
        </a>
      </div>
    );
  }

  if (result.data.plans.length === 0) {
    return (
      <p className="p-5 text-sm leading-6 text-muted-text">
        Plan details are not available right now. Please try again.
      </p>
    );
  }

  return (
    <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
      {result.data.plans.map((plan: Plan): JSX.Element => (
        <article key={plan.id} className="rounded-lg border border-surface-border bg-background/60 p-5">
          <h3 className="text-base font-medium">{plan.name}</h3>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-text">vCPU per replica</dt>
              <dd>{plan.vcpu}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-text">Memory per replica</dt>
              <dd>{plan.memory} GiB</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-text">Deployment slots</dt>
              <dd>{plan.deployments}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-text">Replicas per deployment</dt>
              <dd>{plan.max_replicas}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

function AccountUsageContent({ planResult, deploymentsResult }: AccountUsageContentProps): JSX.Element {
  const deploymentCount: number = deploymentsResult.kind === "success" ? deploymentsResult.deployments.length : 0;
  const deploymentLimit: number | null = planResult.kind === "success"
    ? planResult.data.plans.reduce((total: number, plan: Plan): number => total + plan.deployments, 0)
    : null;

  return (
    <section aria-labelledby="account-usage-heading" className="overflow-hidden rounded-xl border border-surface-border bg-surface/40">
      <div className="border-b border-surface-border px-5 py-4 sm:px-6">
        <h2 id="account-usage-heading" className="text-sm font-medium">Account usage</h2>
      </div>
      <div className="p-5 sm:px-6">
        <p className="text-sm text-muted-text">Deployments (used / total plan slots)</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums">
          {deploymentCount} / {deploymentLimit === null ? "—" : deploymentLimit}
        </p>
      </div>
    </section>
  );
}

function SubscriptionContent({ result }: SubscriptionContentProps): JSX.Element {
  if (result.kind === "unavailable") {
    return (
      <div role="alert" className="m-5 rounded-lg border border-red-400/15 bg-red-400/5 p-5">
        <p className="text-sm text-red-200">
          Subscription information is not available right now. Please try again later.
        </p>
        <a href="/account/billing" className="mt-3 inline-block text-sm text-blue-300 hover:text-blue-200">
          Try again
        </a>
      </div>
    );
  }

  if (result.subscriptions.length === 0) {
    return <p className="p-5 text-sm text-muted-text">No subscriptions found.</p>;
  }

  return (
    <div className="divide-y divide-surface-border">
      {result.subscriptions.map((subscription: CustomerSubscription): JSX.Element => (
        <article key={subscription.id} className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-mono text-xs text-muted-text">{subscription.id}</h3>
            <span className="rounded-md bg-white/5 px-2 py-1 text-xs text-foreground">
              {subscription.status}
            </span>
          </div>
          <p className="mt-3 text-sm text-muted-text">
            {subscription.cancel_at_period_end
              ? `Cancellation scheduled: ${formatCancellationDate(subscription.cancel_at)}.`
              : "No period-end cancellation is scheduled."}
          </p>
          {result.source === "demo" && (
            <div className="mt-4">
              <CancellationControl
                subscriptionId={subscription.id}
                scheduled={subscription.cancel_at_period_end}
              />
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

export async function BillingPage(): Promise<JSX.Element> {
  const [planResult, subscriptionsResult, deploymentsResult]: [UserPlanResult, MySubscriptionsResult, DeploymentsResult] =
    await Promise.all([getUserPlan(), getMySubscriptions(), getDeployments({})]);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <Navbar variant="dashboard" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 sm:px-8 sm:py-16">
        <nav aria-label="Breadcrumb" className="mb-7 flex items-center gap-2 text-xs text-muted-text">
          <a href="/dashboard" className="transition-colors hover:text-foreground">Dashboard</a>
          <span aria-hidden="true" className="text-muted-dark">/</span>
          <span aria-current="page" className="text-foreground">Billing</span>
        </nav>

        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Billing</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-text">
            View your current plan and subscription status.
          </p>
        </header>

        <div className="space-y-8">
          <AccountUsageContent planResult={planResult} deploymentsResult={deploymentsResult} />

          <section aria-labelledby="current-plan-heading" className="overflow-hidden rounded-xl border border-surface-border bg-surface/40">
            <div className="border-b border-surface-border px-5 py-4 sm:px-6">
              <h2 id="current-plan-heading" className="text-sm font-medium">Current plan</h2>
            </div>
            <PlanContent result={planResult} />
          </section>

          <section aria-labelledby="subscriptions-heading" className="overflow-hidden rounded-xl border border-surface-border bg-surface/40">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border px-5 py-4 sm:px-6">
              <h2 id="subscriptions-heading" className="text-sm font-medium">Subscriptions</h2>
              {subscriptionsResult.kind === "success" && subscriptionsResult.source === "demo" && (
                <span className="rounded-md border border-amber-300/20 bg-amber-300/5 px-2 py-1 text-xs text-amber-200">
                  Demo data
                </span>
              )}
            </div>
            <SubscriptionContent result={subscriptionsResult} />
          </section>
        </div>
      </main>
      <footer className="border-t border-surface-border py-6 text-center font-mono text-xs text-muted-dark">
        Kumo
      </footer>
    </div>
  );
}
