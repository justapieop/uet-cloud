import assert from "node:assert/strict";
import { test } from "node:test";
import { Role, User } from "@kumo/domain";
import type { DataSource, EntityManager } from "typeorm";
import { InfraDeployment, InfraPlan, InfraRole, InfraUser, InfraUserRole, InfraVolume, TypeOrmUnitOfWork } from "../dist/db/index.js";

test("unit of work shares one transaction across user and role writes", async (): Promise<void> => {
  const writes: string[] = [];
  const requestedEntities: unknown[] = [];
  const manager: EntityManager = {
    getRepository: (entity: unknown): unknown => {
      requestedEntities.push(entity);
      return {
        create: (value: unknown): unknown => value,
        save: async (value: { id: string }): Promise<void> => {
          writes.push(value.id);
        },
      };
    },
  } as unknown as EntityManager;
  let transactionCalls: number = 0;
  const dataSource: DataSource = {
    transaction: async <T>(work: (transactionManager: EntityManager) => Promise<T>): Promise<T> => {
      transactionCalls++;
      return work(manager);
    },
  } as unknown as DataSource;
  const unitOfWork: TypeOrmUnitOfWork = new TypeOrmUnitOfWork(dataSource);
  const user: User = new User({
    id: "user-1",
    displayName: "User One",
    suspended: false,
  });
  const role: Role = new Role({ id: "role-1", name: "Admin" });

  const result: string = await unitOfWork.run(async ({ users, roles }): Promise<string> => {
    await users.save(user);
    await roles.save(role);
    return "saved";
  });

  assert.equal(result, "saved");
  assert.equal(transactionCalls, 1);
  assert.deepEqual(requestedEntities, [InfraUser, InfraRole, InfraUserRole, InfraDeployment, InfraPlan, InfraVolume]);
  assert.deepEqual(writes, ["user-1", "role-1"]);
});

test("unit of work propagates a write failure to the transaction", async (): Promise<void> => {
  const failure: Error = new Error("write failed");
  let transactionRejected: boolean = false;
  const manager: EntityManager = {
    getRepository: (): unknown => ({
      create: (value: unknown): unknown => value,
      save: async (): Promise<void> => { throw failure; },
    }),
  } as unknown as EntityManager;
  const dataSource: DataSource = {
    transaction: async <T>(work: (transactionManager: EntityManager) => Promise<T>): Promise<T> => {
      try {
        return await work(manager);
      } catch (error: unknown) {
        transactionRejected = true;
        throw error;
      }
    },
  } as unknown as DataSource;
  const unitOfWork: TypeOrmUnitOfWork = new TypeOrmUnitOfWork(dataSource);
  const user: User = new User({
    id: "user-1",
    displayName: "User One",
    suspended: false,
  });

  await assert.rejects(
    unitOfWork.run(async ({ users }): Promise<void> => users.save(user)),
    failure,
  );
  assert.equal(transactionRejected, true);
});
