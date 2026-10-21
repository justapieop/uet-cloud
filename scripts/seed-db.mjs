import "reflect-metadata";
import { readFile } from "node:fs/promises";
import { parseDatabaseSeedInput, seedDatabase } from "../packages/infrastructure/dist/db/index.js";
import { createDatabaseSource } from "./database.mjs";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("Usage: npm run seed:db -- [--data path/to/seed.json]\nReads database settings from the environment or repository .env. See docs/database-seeding.md.");
} else {
  let source;
  try {
    if (args.length !== 0 && (args.length !== 2 || args[0] !== "--data")) throw new Error("Usage: npm run seed:db -- [--data path/to/seed.json]");
    const input = parseDatabaseSeedInput(args.length ? JSON.parse(await readFile(args[1], "utf8")) : {});
    source = createDatabaseSource();
    await source.initialize();
    await source.runMigrations({ transaction: "all" });
    const result = await seedDatabase(source, input);
    console.log(`Seed complete: ${result.rolesCreated} roles, ${result.plansCreated} plans, ${result.assignmentsCreated} assignments created. Admin Super ${result.adminSuperAdded ? "added" : "already configured"}. Other existing configuration preserved.`);
  } catch (error) {
    // Driver errors may include connection strings, queries, or supplied data.
    console.error("Database seed failed. Check the connection, schema, seed data, and existing records.");
    if (!source) console.error(error instanceof Error && !process.env.DATABASE_CONNECTION_URL ? error.message : "Check arguments and database configuration.");
    process.exitCode = 1;
  } finally {
    if (source?.isInitialized) await source.destroy();
  }
}
