import type { SubscriptionRepositories, SubscriptionUnitOfWork } from "@kumo/application";
import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { InfraPlan } from "./repositories/plan.js";
import { InfraSubscriptionPlanReader } from "./repositories/subscription-plan-reader.js";
import { InfraSubscription, InfraSubscriptionRepository } from "./repositories/subscription.js";
import { InfraUser, InfraUserRepository } from "./repositories/user.js";

@Injectable()
export class TypeOrmSubscriptionUnitOfWork implements SubscriptionUnitOfWork {
  public constructor(private readonly dataSource: DataSource) {}

  public run<T>(work: (repositories: SubscriptionRepositories) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager: EntityManager): Promise<T> => {
      const repositories: SubscriptionRepositories = {
        subscriptions: new InfraSubscriptionRepository(manager.getRepository(InfraSubscription)),
        plans: new InfraSubscriptionPlanReader(manager.getRepository(InfraPlan)),
        users: new InfraUserRepository(manager.getRepository(InfraUser)),
      };
      return work(repositories);
    });
  }
}
