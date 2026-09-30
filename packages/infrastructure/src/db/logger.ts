import type { LoggerService } from "@nestjs/common";
import type { ObjectLiteral } from "typeorm";
import type { Logger as TypeOrmLogger } from "typeorm";

type LogLevel = "debug" | "error" | "log" | "warn";
type LogFields = Record<string, string | number | undefined>;
type QueryParameters = unknown[] | ObjectLiteral | undefined;

export class TypeOrmLoggerAdapter implements TypeOrmLogger {
  public constructor(
    private readonly nestLogger: LoggerService,
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
    this.write("log", "schema-build", { message });
  }

  public logMigration(message: string): void {
    this.write("log", "migration", { message });
  }

  public log(level: "log" | "info" | "warn", message: unknown): void {
    const nestLevel: LogLevel = level === "warn" ? "warn" : "log";
    const messageText: string = typeof message === "string" ? message : String(message);

    this.write(nestLevel, level, { message: messageText });
  }

  private countParameters(parameters: QueryParameters): number {
    if (Array.isArray(parameters)) {
      return parameters.length;
    }

    return parameters === undefined ? 0 : Object.keys(parameters).length;
  }

  private write(level: LogLevel, event: string, fields: LogFields): void {
    const payload: string = JSON.stringify({ component: "typeorm", context: this.context, event, ...fields }) ?? "{\"component\":\"typeorm\"}";

    switch (level) {
      case "debug":
        if (this.nestLogger.debug !== undefined) {
          this.nestLogger.debug(payload);
        } else {
          this.nestLogger.log(payload);
        }
        return;
      case "error":
        this.nestLogger.error(payload);
        return;
      case "warn":
        this.nestLogger.warn(payload);
        return;
      case "log":
        this.nestLogger.log(payload);
    }
  }
}
