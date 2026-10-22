import "reflect-metadata";
import { ClassSerializerInterceptor, ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory, Reflector } from "@nestjs/core";
import { RootModule } from "./modules/Root.module.js";
import { Logger } from "nestjs-pino";
import { SwaggerModule } from "@nestjs/swagger";
import session from "express-session";
import passport from "passport";
import MongoStore from "connect-mongo";
import { createSessionCookieOptions } from "./common/Session.options.js";
import { createOpenApiConfig } from "./common/OpenApi.js";

export async function bootstrap(): Promise<void> {
  const app: INestApplication = await NestFactory.create(RootModule, {
    bufferLogs: true,
  });
  const config: ConfigService = app.get(ConfigService);
  const port: number = Number(config.get<string>("PORT", "3000"));
  app.enableShutdownHooks();

  const logger: Logger = app.get(Logger)

  app.useLogger(logger);
  app.useGlobalPipes(new ValidationPipe());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  const sessionSecret: string = config.get<string>("SESSION_SECRET") ?? "kumo-local-session-secret-key-development";
  const mongoUrl: string = config.get<string>("MONGODB_CONNECTION_STRING") ?? "mongodb://127.0.0.1:27017/kumo-session";

  app.use(session({
    saveUninitialized: false,
    resave: false,
    secret: sessionSecret,
    cookie: createSessionCookieOptions(config.get<string>("NODE_ENV", "production")),
    store: MongoStore.create({
      mongoUrl,
      touchAfter: 300,
    }),
  }));
  app.enableCsrfProtection();
  app.useSecurityHeaders();

  app.use(passport.initialize());
  app.use(passport.session());

  SwaggerModule.setup(
    "/api-docs",
    app,
    () => SwaggerModule.createDocument(app, createOpenApiConfig())
  );

  const devMode: boolean = ["development", "test"].includes(config.get<string>("NODE_ENV", "production").trim().toLowerCase());

  if (devMode) { 
    logger.debug("Development or test mode is enabled! We advise against using this mode for production as they are strictly for non-production environment only. Connections to services maybe unencrypted and credentials can be accidentally logged. We are not liable for any damages that are caused by running this app in development or test mode on production");
  }

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }

  await app.listen(port);
}
