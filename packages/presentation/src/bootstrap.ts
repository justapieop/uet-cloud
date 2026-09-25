import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { RootModule } from "./modules/Root.module.js";

export async function bootstrap(): Promise<void> {
  const app: INestApplication = await NestFactory.create(RootModule);
  const config: ConfigService = app.get(ConfigService);
  const port: number = Number(config.get<string>("PORT") ?? "3000");

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }

  await app.listen(port);
}
