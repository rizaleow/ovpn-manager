import { Database } from "bun:sqlite";
import { initSchema } from "./schema.ts";
import { migrateToMultiInstance } from "./migrate.ts";
import type { AppConfig } from "../types/index.ts";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

export function initDb(dbPath: string, config?: AppConfig): Database {
  db = new Database(dbPath, { create: true });

  // Run migration for existing databases before schema init
  if (config) {
    migrateToMultiInstance(db, config);
  }

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
