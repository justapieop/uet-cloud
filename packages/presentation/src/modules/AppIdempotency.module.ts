import type { User } from "@kumo/domain";
import { reliabilityNumber, SqlServerIdempotencyStore } from "@kumo/infrastructure";
import { ForbiddenException, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IdempotencyModule, IdempotencyStorage, type IdempotencyModuleOptions } from "@nestjs/idempotency";
import type { Request } from "express";
import { DataSource } from "typeorm";
import { AppConfigModule } from "./AppConfig.module.js";
import { DatabaseModule } from "./Database.module.js";

@Module({
  imports: [
    IdempotencyModule.forRootAsync({
      imports: [AppConfigModule],
      useFactory: (config: ConfigService): IdempotencyModuleOptions => ({
        ttl: reliabilityNumber(config, "IDEMPOTENCY_TTL_MS", 86_400_000, 2_592_000_000),
        lockTtl: "30s", maxLockHold: "2m", storeTimeout: "5s",
        replayHeaders: ["cache-control"],
        storeIf: (status: number): boolean => (status >= 200 && status < 300) || status === 400 || status === 422,
        scope: (request: Request): string => {
          const user: User | undefined = request.user as User | undefined;
          if (!request.isAuthenticated?.() || !user || user.suspended) throw new ForbiddenException();
          return user.id;
        },
      }),
      inject: [ConfigService],
    }),
    DatabaseModule,
  ],
  providers: [{
    provide: SqlServerIdempotencyStore,
    useFactory: (dataSource: DataSource, storage: IdempotencyStorage): SqlServerIdempotencyStore => {
      const store: SqlServerIdempotencyStore = new SqlServerIdempotencyStore(dataSource);
      storage.registerSource(store);
      return store;
    },
    inject: [DataSource, IdempotencyStorage],
  }],
  exports: [IdempotencyModule],
})
export class AppIdempotencyModule {}
