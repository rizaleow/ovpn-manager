import { Database } from "bun:sqlite";
import { initSchema } from "./schema.ts";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

export function initDb(dbPath: string): Database {
  db = new Database(dbPath, { create: true });
  initSchema(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** For testing: inject a pre-configured Database instance */
export function setDb(instance: Database): void {
  db = instance;
}
