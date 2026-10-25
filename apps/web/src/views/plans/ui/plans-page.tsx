import type { JSX } from "react";
import type { Plan } from "@/entities/plan";
import { getPlans } from "@/entities/plan/server";
import { SelectPlanButton } from "@/features/select-plan";
import { Navbar } from "@/widgets/navbar";

export async function PlansPage(): Promise<JSX.Element> {
  const plans: Plan[] | null = await getPlans();

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <Navbar variant="dashboard" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12 sm:px-8 sm:py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Choose a plan</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-text">Select a plan to start deploying your applications. Pricing and billing details are confirmed at checkout.</p>
        {plans === null ? (
          <div role="alert" className="mt-10 rounded-xl border border-surface-border bg-surface p-6">
            <p className="text-sm text-muted-text">Plans could not be loaded. Please try again.</p>
            <a href="/plans" className="mt-4 inline-block text-sm text-blue-300 hover:text-blue-200">Try again</a>
          </div>
        ) : plans.length === 0 ? (
          <div className="mt-10 rounded-xl border border-surface-border bg-surface p-6">
            <h2 className="text-base font-medium">No plans are available right now</h2>
            <p className="mt-2 text-sm text-muted-text">Please check again later.</p>
            <a href="/plans" className="mt-4 inline-block text-sm text-blue-300 hover:text-blue-200">Refresh plans</a>
          </div>
        ) : (
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan: Plan): JSX.Element => (
              <section key={plan.id} className="flex flex-col rounded-xl border border-surface-border bg-surface p-6">
                <h2 className="text-xl font-semibold tracking-tight">{plan.name}</h2>
                <dl className="my-6 space-y-3 text-sm">
                  <div className="flex justify-between gap-4"><dt className="text-muted-text">vCPU per replica</dt><dd>{plan.vcpu}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-muted-text">Memory per replica</dt><dd>{plan.memory} GiB</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-muted-text">Deployments</dt><dd>{plan.deployments}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-muted-text">Replicas per deployment</dt><dd>{plan.max_replicas}</dd></div>
                </dl>
                <div className="mt-auto"><SelectPlanButton planId={plan.id} /></div>
              </section>
            ))}
          </div>
        )}
      </main>
      <footer className="border-t border-surface-border py-6 text-center font-mono text-xs text-muted-dark">Kumo</footer>
    </div>
  );
}