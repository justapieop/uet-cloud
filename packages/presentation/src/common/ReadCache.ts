import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Inject, Injectable, SetMetadata, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { User } from "@kumo/domain";
import type { Cache } from "cache-manager";
import { instanceToPlain } from "class-transformer";
import type { Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { from, mergeMap, of, type Observable } from "rxjs";

type ReadCacheGroup = "deployments" | "builds";
interface ReadCachePolicy { readonly group: ReadCacheGroup; readonly ttlMs: number; }
interface CachedResponse { readonly payload: unknown; }
const READ_CACHE_POLICY: symbol = Symbol("READ_CACHE_POLICY");

export function CacheRead(group: ReadCacheGroup, ttlMs: number): MethodDecorator {
  return SetMetadata(READ_CACHE_POLICY, { group, ttlMs } satisfies ReadCachePolicy);
}

@Injectable()
export class RouteReadCache {
  public constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  public async key(userId: string, group: ReadCacheGroup, url: string): Promise<string | undefined> {
    try {
      const generation: string = await this.cache.get<string>(this.generationKey(userId, group)) ?? "0";
      const parsed: URL = new URL(url, "http://kumo.local");
      parsed.searchParams.sort();
      const identity: string = createHash("sha256").update(`${parsed.pathname}${parsed.search}`).digest("hex");
      return `kumo:read:v1:${encodeURIComponent(userId)}:${group}:${generation}:${identity}`;
    } catch { return undefined; }
  }

  public async get(key: string): Promise<CachedResponse | undefined> {
    try { return await this.cache.get<CachedResponse>(key); } catch { return undefined; }
  }

  public async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    try {
      // Cache only the exposed response fields. Redis does not preserve DTO prototypes.
      const payload: Record<string, unknown> | Record<string, unknown>[] = instanceToPlain(value);
      await this.cache.set(key, { payload } satisfies CachedResponse, ttlMs);
    } catch {
      // Cache outages must not fail an otherwise successful request or log response data.
    }
  }

  public async invalidateDeployments(userId: string): Promise<void> {
    try {
      // Keep the generation stable until the next write, including for slow in-flight reads.
      // Cached responses from old generations still expire after their two-second TTL.
      await this.cache.set(this.generationKey(userId, "deployments"), randomUUID(), 0);
    } catch { /* Reads remain bounded by their TTL when invalidation is unavailable. */ }
  }

  private generationKey(userId: string, group: ReadCacheGroup): string {
    return `kumo:read:v1:${encodeURIComponent(userId)}:${group}:generation`;
  }
}

@Injectable()
export class UserReadCacheInterceptor implements NestInterceptor<unknown, unknown> {
  public constructor(private readonly cache: RouteReadCache, private readonly reflector: Reflector) {}

  public async intercept(context: ExecutionContext, next: CallHandler<unknown>): Promise<Observable<unknown>> {
    const policy: ReadCachePolicy | undefined = this.reflector.get<ReadCachePolicy>(READ_CACHE_POLICY, context.getHandler());
    if (!policy || context.getType() !== "http") return next.handle();
    const request: Request = context.switchToHttp().getRequest<Request>();
    const response: Response = context.switchToHttp().getResponse<Response>();
    const user: User | undefined = request.user as User | undefined;
    // Guards still run on every hit; never bypass the controller's suspended-user check.
    if (request.method !== "GET" || !request.isAuthenticated?.() || !user || user.suspended) return next.handle();
    const directives: string = request.get("cache-control") ?? "";
    if (/\b(?:no-cache|no-store)\b/i.test(directives) || request.get("pragma")?.toLowerCase() === "no-cache") {
      response.setHeader("X-Cache", "BYPASS");
      return next.handle();
    }
    const key: string | undefined = await this.cache.key(user.id, policy.group, request.originalUrl);
    if (!key) {
      response.setHeader("X-Cache", "BYPASS");
      return next.handle();
    }
    const cached: CachedResponse | undefined = await this.cache.get(key);
    if (cached) {
      response.setHeader("X-Cache", "HIT");
      return of(cached.payload);
    }
    response.setHeader("X-Cache", "MISS");
    return next.handle().pipe(mergeMap((value: unknown): Observable<unknown> => from((async (): Promise<unknown> => {
      if (response.statusCode === 200) await this.cache.set(key, value, policy.ttlMs);
      return value;
    })())));
  }
}
