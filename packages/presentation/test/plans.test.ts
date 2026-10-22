import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ClassSerializerInterceptor, Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { GetPlansCase } from "@kumo/application";
import { Plan } from "@kumo/domain";
import { PlansController } from "../dist/controllers/Plans.controller.js";

test("public plan catalog returns exposed fields and an empty array when no plans are available", async (context: TestContext): Promise<void> => {
  let plans: Plan[] = [new Plan({ id: "starter", name: "Starter", price: 5, vcpu: 1, memory: 2, deployments: 2, disk: 10, maxReplicas: 3, stripeProductId: "prod_internal" })];
  class CatalogModule {}
  Module({ controllers: [PlansController], providers: [{ provide: GetPlansCase, useValue: new GetPlansCase({ findAvailable: async (): Promise<Plan[]> => plans }) }] })(CatalogModule);
  const app: INestApplication = await NestFactory.create(CatalogModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  await app.listen(0, "127.0.0.1");
  const url: string = `${await app.getUrl()}/plans`;
  const response: Response = await fetch(url);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ id: "starter", name: "Starter", price: 5, vcpu: 1, memory: 2, deployments: 2, disk: 10, max_replicas: 3 }]);
  plans = [];
  assert.deepEqual(await (await fetch(url)).json(), []);
});
