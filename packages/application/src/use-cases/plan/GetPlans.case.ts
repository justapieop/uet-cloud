import type { Plan } from "@kumo/domain";
import type { PlanCatalogReader } from "../../ports/plan.js";

export class GetPlansCase {
  public constructor(private readonly plans: PlanCatalogReader) {}

  public exec(): Promise<Plan[]> {
    return this.plans.findAvailable();
  }
}
