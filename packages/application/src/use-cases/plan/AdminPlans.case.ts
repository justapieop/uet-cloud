import { Plan, type PlanDetails } from "@kumo/domain";
import { AdminBillingNotFound, type AdminPlanRepository } from "../../ports/admin-billing.js";

export class AdminPlansCase {
  public constructor(private readonly plans: AdminPlanRepository) {}

  public async list(page: number, perPage: number): Promise<{ plans: Plan[]; hasNextPage: boolean }> {
    const plans: Plan[] = await this.plans.list(page, perPage);
    return { plans: plans.slice(0, perPage), hasNextPage: plans.length > perPage };
  }

  public async get(id: string): Promise<Plan> {
    const plan: Plan | null = await this.plans.findById(id);
    if (!plan) throw new AdminBillingNotFound("Plan not found");
    return plan;
  }

  public async create(details: PlanDetails): Promise<Plan> {
    const plan: Plan = new Plan(details);
    await this.plans.insert(plan);
    return plan;
  }

  public async replace(details: PlanDetails): Promise<Plan> {
    const plan: Plan = new Plan(details);
    await this.plans.replace(plan);
    return plan;
  }

  public deactivate(id: string): Promise<void> {
    return this.plans.deactivate(id);
  }
}
