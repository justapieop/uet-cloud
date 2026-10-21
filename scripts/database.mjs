import "reflect-metadata";
import { DataSource } from "typeorm";
import { DATABASE_MIGRATIONS, InfraDeployment, InfraPlan, InfraRole, InfraUser, InfraUserRole } from "../packages/infrastructure/dist/db/index.js";

export function createDatabaseSource() {
  const required = (name) => {
    const value = process.env[name];
    if (!value?.trim()) throw new Error(`Missing ${name}`);
    return value;
  };
  const connection = process.env.DATABASE_CONNECTION_URL
    ? { url: process.env.DATABASE_CONNECTION_URL }
    : { host: required("DATABASE_URL"), port: Number(required("DATABASE_PORT")), database: required("DATABASE_NAME") };
  if ("port" in connection && (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535)) throw new Error("Invalid DATABASE_PORT");
  return new DataSource({
    type: "mssql", ...connection,
    authentication: { type: "azure-active-directory-default", options: {} },
    options: { encrypt: (process.env.DATABASE_ENABLE_ENCRYPTION ?? "true").trim().toLowerCase() === "true" },
    entities: [InfraUser, InfraRole, InfraUserRole, InfraDeployment, InfraPlan],
    migrations: DATABASE_MIGRATIONS, migrationsRun: false, synchronize: false, logging: false,
  });
}
