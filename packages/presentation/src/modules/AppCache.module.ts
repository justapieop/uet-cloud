import { Global, Module } from "@nestjs/common";
import { CacheModule } from "@nestjs/cache-manager";
import { ConfigService } from "@nestjs/config";
import { createKeyv } from "@keyv/redis";
import { RouteReadCache, UserReadCacheInterceptor } from "../common/ReadCache.js";

@Global()
@Module({
  imports: [
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
  providers: [RouteReadCache, UserReadCacheInterceptor],
  exports: [CacheModule, RouteReadCache, UserReadCacheInterceptor],
})
export class AppCacheModule { }
