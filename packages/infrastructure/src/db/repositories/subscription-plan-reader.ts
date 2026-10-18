import type { SubscriptionPlanReader } from "@kumo/application";
import { Plan } from "@kumo/domain";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { InfraPlan } from "./plan.js";

@Injectable()
export class InfraSubscriptionPlanReader implements SubscriptionPlanReader {
  public constructor(@InjectRepository(InfraPlan) private readonly repository: Repository<InfraPlan>) {}

  public async findById(id: string): Promise<Plan | null> {
    const record: InfraPlan | null = await this.repository.findOneBy({ id });
    return record ? new Plan({
      id: record.id, name: record.name, price: record.price, vcpu: record.vcpu,
      memory: record.memory, deployments: record.deployments, disk: record.disk, active: record.active,
    }) : null;
  }
}
