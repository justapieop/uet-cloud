import type { PinoLogger } from "nestjs-pino";
import type { ObjectLiteral } from "typeorm";
import type { Logger as TypeOrmLogger } from "typeorm";

type LogLevel = "debug" | "error" | "info" | "warn";
type LogFields = Record<string, string | number | undefined>;
type QueryParameters = unknown[] | ObjectLiteral | undefined;

export class TypeOrmLoggerAdapter implements TypeOrmLogger {
  public constructor(
    private readonly pinoLogger: PinoLogger,
    private readonly context: string = TypeOrmLoggerAdapter.name,
  ) { }

  public logQuery(query: string, parameters?: QueryParameters): void {
    this.write("debug", "query", {
      query,
      parameterCount: this.countParameters(parameters),
    });
  }

  public logQueryError(error: string | Error, query: string, parameters?: QueryParameters): void {
    const fields: LogFields = {
      query,
      parameterCount: this.countParameters(parameters),
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    };

    this.write("error", "query-error", fields);
  }

  public logQuerySlow(time: number, query: string, parameters?: QueryParameters): void {
    this.write("warn", "query-slow", {
      durationMs: time,
      query,
      parameterCount: this.countParameters(parameters),
    });
  }

  public logSchemaBuild(message: string): void {
    this.write("info", "schema-build", { message });
  }

  public logMigration(message: string): void {
    this.write("info", "migration", { message });
  }

  public log(level: "log" | "info" | "warn", message: unknown): void {
    const pinoLevel: LogLevel = level === "warn" ? "warn" : "info";
    const messageText: string = typeof message === "string" ? message : String(message);

    this.write(pinoLevel, level, { message: messageText });
  }

  private countParameters(parameters: QueryParameters): number {
    if (Array.isArray(parameters)) {
      return parameters.length;
    }

    return parameters === undefined ? 0 : Object.keys(parameters).length;
  }

  private write(level: LogLevel, event: string, fields: LogFields): void {
    const structuredFields: LogFields & { component: string; context: string; event: string } = {
      component: "typeorm",
      context: this.context,
      event,
      ...fields,
    };
    const message: string = `TypeORM ${event}`;

    switch (level) {
      case "debug":
        this.pinoLogger.debug(structuredFields, message);
        return;
      case "error":
        this.pinoLogger.error(structuredFields, message);
        return;
      case "warn":
        this.pinoLogger.warn(structuredFields, message);
        return;
      case "info":
        this.pinoLogger.info(structuredFields, message);
    }
  }
}
