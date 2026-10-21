import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Reflector } from "@nestjs/core";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import type { Cache } from "cache-manager";
import { firstValueFrom, from, type Observable } from "rxjs";
import { User } from "@kumo/domain";
import { CacheRead, RouteReadCache, UserReadCacheInterceptor } from "../dist/common/ReadCache.js";

test("read cache coalesces misses, uses state-aware TTLs, and honors invalidation/bypass", async (): Promise<void> => {
  const records: Map<string, unknown> = new Map();
  const ttls: number[] = [];
  const backend: Pick<Cache, "get" | "set"> = {
    get: async <T>(key: string): Promise<T | undefined> => records.get(key) as T | undefined,
    set: async <T>(key: string, value: T, ttl?: number): Promise<T> => { records.set(key, value); ttls.push(ttl ?? 0); return value; },
  };
  const cache: RouteReadCache = new RouteReadCache(backend);
  const interceptor: UserReadCacheInterceptor = new UserReadCacheInterceptor(cache, new Reflector());
  let bypass: boolean = false;
  let status: string = "RUNNING";
  let calls: number = 0;
  let group: "deployments" | "builds" = "deployments";
  class Fixture { public read(): void {} }
  const context: ExecutionContext = {
    getType: (): string => "http", getHandler: () => Fixture.prototype.read, getClass: () => Fixture,
    switchToHttp: () => ({
      getRequest: () => ({ method: "GET", user: new User({ id: "123", displayName: "Alice", suspended: false }),
        isAuthenticated: (): boolean => true, originalUrl: `/${group}`, get: (): string => bypass ? "no-cache" : "",
      }),
      getResponse: () => ({ statusCode: 200, setHeader: (): void => {} }),
    }),
  } as unknown as ExecutionContext;
  const next: CallHandler<unknown> = { handle: (): Observable<unknown> => from((async (): Promise<unknown> => {
    calls++; await new Promise<void>((resolve: () => void): void => { setImmediate(resolve); }); return { status };
  })()) };
  CacheRead(group, 2000)(Fixture.prototype, "read", Object.getOwnPropertyDescriptor(Fixture.prototype, "read")!);
  const load: () => Promise<unknown> = async (): Promise<unknown> => firstValueFrom(await interceptor.intercept(context, next));
  await Promise.all(Array.from({ length: 8 }, (): Promise<unknown> => load()));
  assert.equal(calls, 1); assert.equal(ttls.at(-1), 10_000);
  await load(); assert.equal(calls, 1);
  await cache.invalidateDeployments("123");
  status = "PENDING";
  await load(); assert.equal(calls, 2); assert.equal(ttls.at(-1), 2000);
  bypass = true;
  await load(); assert.equal(calls, 3);
  bypass = false; group = "builds"; status = "SUCCEEDED";
  CacheRead(group, 2000)(Fixture.prototype, "read", Object.getOwnPropertyDescriptor(Fixture.prototype, "read")!);
  await load(); assert.equal(ttls.at(-1), 30_000);
});

test("failed coalesced reads are released and never cached", async (): Promise<void> => {
  let calls: number = 0;
  const cache: RouteReadCache = new RouteReadCache({} as Pick<Cache, "get" | "set">);
  const load: () => Observable<unknown> = (): Observable<unknown> => cache.coalesce("key", (): Observable<unknown> => from((async (): Promise<never> => {
    calls++; await new Promise<void>((resolve: () => void): void => { setImmediate(resolve); }); throw new Error("Unavailable");
  })()));
  await Promise.all([assert.rejects(firstValueFrom(load())), assert.rejects(firstValueFrom(load()))]);
  assert.equal(calls, 1);
  await assert.rejects(firstValueFrom(load())); assert.equal(calls, 2);
});
