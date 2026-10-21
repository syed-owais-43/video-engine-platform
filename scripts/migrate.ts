// Applies SQL migrations from ./drizzle to DATABASE_URL, or to the local PGlite database.
import { mkdirSync } from "node:fs";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";

const migrationsFolder = "./drizzle";

async function main() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = postgres(url, { max: 1 });
    await migratePg(drizzlePg(client), { migrationsFolder });
    await client.end();
    console.log("Migrated Postgres database.");
    return;
  }
  const dir = process.env.PGLITE_DIR ?? ".data/pglite";
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  await migratePglite(drizzlePglite(client), { migrationsFolder });
  await client.close();
  console.log(`Migrated local PGlite database at ${dir}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
