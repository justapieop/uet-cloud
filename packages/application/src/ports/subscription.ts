import type { Plan, Subscription } from "@kumo/domain";
import type { UserRepository } from "./user.js";

export interface SubscriptionListFilters {
  readonly active?: boolean;
  readonly planId?: string;
}

export interface SubscriptionRepository {
  findById(id: string): Promise<Subscription | null>;
  findByIdAndUserId(id: string, userId: string): Promise<Subscription | null>;
  findByUserId(userId: string, filters?: SubscriptionListFilters): Promise<Subscription[]>;
  save(subscription: Subscription): Promise<void>;
  update(subscription: Subscription): Promise<void>;
}

export interface SubscriptionPlanReader {
  findById(id: string): Promise<Plan | null>;
}

export interface SubscriptionRepositories {
  readonly subscriptions: SubscriptionRepository;
  readonly plans: SubscriptionPlanReader;
  readonly users: UserRepository;
}

/** Supplies repositories bound to the same database transaction. */
export interface SubscriptionUnitOfWork {
  run<T>(work: (repositories: SubscriptionRepositories) => Promise<T>): Promise<T>;
}

export const SUBSCRIPTION_REPOSITORY: symbol = Symbol("SUBSCRIPTION_REPOSITORY");
export const SUBSCRIPTION_PLAN_READER: symbol = Symbol("SUBSCRIPTION_PLAN_READER");
export const SUBSCRIPTION_UNIT_OF_WORK: symbol = Symbol("SUBSCRIPTION_UNIT_OF_WORK");

export class SubscriptionNotFound extends Error {}
export class SubscriptionPlanNotFound extends Error {}
export class SubscriptionPlanInactive extends Error {}
export class SubscriptionUserNotFound extends Error {}
export class SubscriptionInactive extends Error {}
