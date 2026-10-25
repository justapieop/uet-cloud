import { Global, Module } from "@nestjs/common";
import { CACHE_MANAGER, CacheModule } from "@nestjs/cache-manager";
import { ResilienceService, type ResiliencePolicy } from "@nestjs/resilience";
import type { Cache } from "cache-manager";
import { AppResilienceModule } from "./AppResilience.module.js";
import { ConfigService } from "@nestjs/config";
import { createKeyv } from "@keyv/redis";
import { RouteReadCache, UserReadCacheInterceptor } from "../common/ReadCache.js";

@Global()
@Module({
  imports: [
    AppResilienceModule,
    CacheModule.registerAsync({
      inject: [
        ConfigService,
      ],
      useFactory: async (config: ConfigService) => ({
        ttl: 2000,
        stores: [
          createKeyv(config.getOrThrow("REDIS_CONNECTION_URL")),
        ],
      }),
    }),
  ],
  providers: [
    {
      provide: RouteReadCache,
      useFactory: (cache: Cache, resilience: ResilienceService): RouteReadCache => {
        const policy: ResiliencePolicy = resilience.preset("cache");
        const client: Pick<Cache, "get" | "set"> = {
          get: <T>(key: string): Promise<T | undefined> => policy.execute((): Promise<T | undefined> => cache.get<T>(key), { source: "cache.get" }),
          set: <T>(key: string, value: T, ttl?: number): Promise<T> => policy.execute((): Promise<T> => cache.set(key, value, ttl), { source: "cache.set" }),
        };
        return new RouteReadCache(client);
      },
      inject: [CACHE_MANAGER, ResilienceService],
    },
    UserReadCacheInterceptor,
  ],
  exports: [CacheModule, RouteReadCache, UserReadCacheInterceptor],
})
export class AppCacheModule { }
