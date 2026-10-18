# Plan subscriptions

A subscription links one user to an existing plan through `userId` and `planId`. Its `active` flag describes whether that subscription is active. The model does not currently define payment due dates, billing periods, payment verification, or grace periods.

## Application ports

`SubscriptionRepository` provides lookup by ID, owner-scoped lookup/listing, insertion, and owner-scoped updates. Listing accepts optional `active` and `planId` filters. Adapters must enforce the owner scope and must not turn an insert into an overwrite of an existing subscription.

`SubscriptionPlanReader` reads plans from the existing `plans` catalog. It does not create a separate plan store. `SubscriptionUnitOfWork` supplies subscription, plan, and user repositories bound to one database transaction, allowing reference checks and subscription writes to run together. Its TypeORM implementation supplies adapters using the same transaction's entity manager.

## Use cases

| Use case | Behavior |
| --- | --- |
| `CreateSubscriptionCase` | Checks that the user exists and the referenced plan is active, generates a UUID, and inserts the subscription with an explicitly supplied boolean `active`. |
| `GetSubscriptionCase` | Gets an owned subscription or lists the user's subscriptions with optional active/plan filters. |
| `ChangeSubscriptionPlanCase` | Selects another existing active plan while preserving ownership, creation time, and activation state. |
| `ActivateSubscriptionCase` | Activates an owned subscription after checking that its plan exists and is active. |
| `DeactivateSubscriptionCase` | Marks an owned subscription inactive while preserving the relationship and history. |
| `EnsureActiveSubscriptionCase` | Rejects an operation when the user has no active subscription. |

Activation, deactivation, and selecting the current plan are idempotent and avoid unnecessary writes. No subscription-count or unique-user/plan policy is imposed; those business rules remain to be defined.

## Persistence and NestJS composition

`InfraSubscriptionRepository` implements subscription reads, insertion, and updates. Inserts cannot overwrite an existing subscription ID. Updates match both the subscription ID and user ID and only change `planId` and `active`; ownership and creation time remain unchanged. Missing updates throw `SubscriptionNotFound`. Owner-scoped lists support both active values, optional plan filtering, and newest-first ordering.

`InfraSubscriptionPlanReader` loads the existing `plans` entity into the domain model. `TypeOrmSubscriptionUnitOfWork` supplies this reader, the subscription repository, and the user repository bound to one TypeORM transaction.

The appended `Subscriptions1792272000000` migration creates `subscriptions` with required `id`, `user_id`, `plan_id`, `active`, and `created_at` columns. Foreign keys link the existing users and plans tables with no cascading deletion. Indexes support user/active and plan lookups. Raw inserts default `active` to false; the create use case still requires an explicit boolean. No subscription rows are seeded or migrated from billing data. API startup runs the registered migration through the existing database configuration; rolling it back drops the subscription table and its rows.

`DatabaseModule` registers the entity and adapters and binds `SUBSCRIPTION_REPOSITORY`, `SUBSCRIPTION_PLAN_READER`, and `SUBSCRIPTION_UNIT_OF_WORK`. `SubscriptionModule`, imported by `RootModule`, constructs and exports all six application use cases with explicit factory injection. Other Nest modules can import `SubscriptionModule` to inject these use cases.

These remain internal application operations, not authorization rules or public endpoints. The presentation layer must authorize who may create, activate, deactivate, or change a subscription. Setting `active` does not verify payment or stop/start Azure workloads. HTTP endpoints, payment handling, deployment eligibility enforcement, and workload suspension are separate implementation tasks.
