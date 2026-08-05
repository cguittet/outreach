import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db";

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [731940217]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS _trucea_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Resolve migrations dir from the script's location, handling both dev (apps/web/server/)
    // and production build (apps/web/dist/server/) execution contexts.
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const isBuilt = scriptDir.includes("/dist/server");
    const migrationsDir = path.resolve(scriptDir, isBuilt ? "../../../../database/migrations" : "../../../database/migrations");
    const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const existing = await client.query("SELECT 1 FROM _trucea_migrations WHERE name = $1", [file]);
      if (existing.rowCount) continue;
      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _trucea_migrations(name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.info(`[database] applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [731940217]).catch(() => undefined);
    client.release();
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  runMigrations()
    .then(() => getPool().end())
    .catch((error) => {
      console.error("[database] migration failed", error);
      process.exit(1);
    });
}
