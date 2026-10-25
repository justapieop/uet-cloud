import "reflect-metadata";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { ClassSerializerInterceptor, Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { GetDeploymentRegionsCase, type DeploymentRegion } from "@kumo/application";
import { User } from "@kumo/domain";
import type { NextFunction, Request, Response } from "express";
import { RegionsController } from "../dist/controllers/Regions.controller.js";

test("regions HTTP requires an eligible session, rejects subscription selectors, and sanitizes Azure failures", async (context: TestContext): Promise<void> => {
  let authenticated: boolean = true;
  let active: boolean = true;
  let suspended: boolean = false;
  let fail: boolean = false;
  let reads: number = 0;
  class RegionFixtureModule {}
  Module({ controllers: [RegionsController], providers: [{ provide: GetDeploymentRegionsCase, useValue: new GetDeploymentRegionsCase({
    list: async (): Promise<DeploymentRegion[]> => {
      reads++;
      if (fail) throw new Error("secret Azure credentials");
      return [{ name: "japaneast", displayName: "Japan East" }];
    },
  }) }] })(RegionFixtureModule);
  const app: INestApplication = await NestFactory.create(RegionFixtureModule, { logger: false, abortOnError: false });
  context.after(async (): Promise<void> => { await app.close(); });
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.use((request: Request, _response: Response, next: NextFunction): void => {
    request.user = authenticated ? new User({ id: "123", displayName: "Alice", active, suspended }) : undefined;
    request.isAuthenticated = ((): boolean => authenticated) as Request["isAuthenticated"];
    next();
  });
  await app.listen(0, "127.0.0.1");
  const url: string = `${await app.getUrl()}/regions`;
  const response: globalThis.Response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), [{ name: "japaneast", display_name: "Japan East" }]);
  assert.equal((await fetch(`${url}?subscription_id=other`)).status, 400);
  authenticated = false;
  assert.equal((await fetch(url)).status, 403);
  authenticated = true;
  active = false;
  assert.equal((await fetch(url)).status, 403);
  active = true;
  suspended = true;
  assert.equal((await fetch(url)).status, 403);
  suspended = false;
  assert.equal(reads, 1);
  fail = true;
  const unavailable: globalThis.Response = await fetch(url);
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /secret Azure/);
});
