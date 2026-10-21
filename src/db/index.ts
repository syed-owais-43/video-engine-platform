import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

// With DATABASE_URL set (Neon/Supabase/any Postgres) we use postgres-js.
// Without it, an embedded PGlite database in .data/ lets the app run locally with zero setup.
export const PGLITE_DIR = process.env.PGLITE_DIR ?? ".data/pglite";

function create(): DB {
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = postgres(url, { max: 5, prepare: false });
    return drizzlePg(client, { schema });
  }
  const client = new PGlite(PGLITE_DIR);
  return drizzlePglite(client, { schema }) as unknown as DB;
}

const g = globalThis as unknown as { __db?: DB };

// Connect on first use, not on import, so build workers that never query don't open the database.
export const db: DB = new Proxy({} as DB, {
  get(_, prop) {
    const real = (g.__db ??= create());
    const value = Reflect.get(real, prop);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
export { schema };
