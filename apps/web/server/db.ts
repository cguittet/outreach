import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../../database/schema/schema";

const { Pool } = pg;

let poolInstance: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!poolInstance) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    poolInstance = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX ?? 10),
    });
  }
  return poolInstance;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}
