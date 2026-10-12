import { Module } from "@nestjs/common";
import { CacheModule } from "@nestjs/cache-manager";
import { ConfigService } from "@nestjs/config";
import { createKeyv } from "@keyv/redis";

@Module({
  imports: [
    CacheModule.registerAsync({
      inject: [
        ConfigService,
      ],
      useFactory: async (config: ConfigService) => ({
        stores: [
          createKeyv(config.getOrThrow("REDIS_CONNECTION_URL")),
        ],
      }),
    }),
  ],
})
export class AppCacheModule { }