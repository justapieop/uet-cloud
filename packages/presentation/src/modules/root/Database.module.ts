import type { DynamicModule } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { databaseOptionsProvider } from "@kumo/infrastructure";

export const DatabaseModule: DynamicModule = TypeOrmModule.forRootAsync(databaseOptionsProvider);
