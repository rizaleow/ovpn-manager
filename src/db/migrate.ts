import type { Database } from "bun:sqlite";
import type { AppConfig } from "../types/index.ts";

/**
 * Migrates a pre-multi-instance database to the new schema.
 * Runs automatically on startup if the `instances` table doesn't exist
 * but old singleton tables do.
 */
export function migrateToMultiInstance(db: Database, config: AppConfig): void {
  // Check if migration is needed
  const hasInstances = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='instances'")
    .get();

  if (hasInstances) return; // Already migrated or fresh DB

  // Check if there's an old-style database to migrate
  const hasOldServerConfig = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='server_config'")
    .get();

  if (!hasOldServerConfig) return; // Fresh install, no migration needed

  console.log("Migrating database to multi-instance schema...");

  db.exec("BEGIN TRANSACTION;");

  try {
    // 1. Create instances table
    db.exec(`
      CREATE TABLE instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        display_name TEXT,
        status TEXT NOT NULL DEFAULT 'setup'
          CHECK (status IN ('setup', 'active', 'inactive', 'error')),
        easyrsa_dir TEXT NOT NULL,
        config_path TEXT NOT NULL,
        status_file TEXT NOT NULL,
        log_file TEXT NOT NULL,
        ccd_dir TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // 2. Insert "default" instance using existing config paths
    db.run(
      `INSERT INTO instances (name, display_name, status, easyrsa_dir, config_path, status_file, log_file, ccd_dir)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "default",
        "Default",
        "active",
        config.paths.easyrsaDir,
        config.paths.serverConfigPath,
        config.paths.statusFile,
        config.paths.logFile,
        config.paths.clientConfigDir,
      ],
    );

    const defaultInstance = db.query("SELECT id FROM instances WHERE name = 'default'").get() as { id: number };
    const instanceId = defaultInstance.id;

    // 3. Migrate server_config — rename-recreate pattern
    db.exec(`ALTER TABLE server_config RENAME TO _old_server_config;`);
    db.exec(`
      CREATE TABLE server_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id INTEGER NOT NULL UNIQUE REFERENCES instances(id) ON DELETE CASCADE,
        hostname TEXT NOT NULL DEFAULT 'vpn.example.com',
        protocol TEXT NOT NULL DEFAULT 'udp',
        port INTEGER NOT NULL DEFAULT 1194,
        dev_type TEXT NOT NULL DEFAULT 'tun',
        subnet TEXT NOT NULL DEFAULT '10.8.0.0',
        subnet_mask TEXT NOT NULL DEFAULT '255.255.255.0',
        dns TEXT NOT NULL DEFAULT '["1.1.1.1","1.0.0.1"]',
        cipher TEXT NOT NULL DEFAULT 'AES-256-GCM',
        auth TEXT NOT NULL DEFAULT 'SHA256',
        tls_auth INTEGER NOT NULL DEFAULT 1,
        compress TEXT NOT NULL DEFAULT '',
        client_to_client INTEGER NOT NULL DEFAULT 0,
        max_clients INTEGER NOT NULL DEFAULT 100,
        keepalive TEXT NOT NULL DEFAULT '10 120',
        pki_initialized INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.run(
      `INSERT INTO server_config (instance_id, hostname, protocol, port, dev_type, subnet, subnet_mask, dns, cipher, auth, tls_auth, compress, client_to_client, max_clients, keepalive, pki_initialized, created_at, updated_at)
       SELECT ?, hostname, protocol, port, dev_type, subnet, subnet_mask, dns, cipher, auth, tls_auth, compress, client_to_client, max_clients, keepalive, pki_initialized, created_at, updated_at
       FROM _old_server_config WHERE id = 1`,
      [instanceId],
    );
    db.exec(`DROP TABLE _old_server_config;`);

    // 4. Migrate clients
    db.exec(`ALTER TABLE clients RENAME TO _old_clients;`);
    db.exec(`
      CREATE TABLE clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
        cert_cn TEXT NOT NULL,
        static_ip TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        revoked_at TEXT,
        expires_at TEXT,
        notes TEXT,
        UNIQUE(instance_id, name)
      );
    `);
    db.run(
      `INSERT INTO clients (id, instance_id, name, email, status, cert_cn, static_ip, created_at, revoked_at, expires_at, notes)
       SELECT id, ?, name, email, status, cert_cn, static_ip, created_at, revoked_at, expires_at, notes
       FROM _old_clients`,
      [instanceId],
    );
    db.exec(`DROP TABLE _old_clients;`);

    // 5. Migrate connection_log
    db.exec(`ALTER TABLE connection_log RENAME TO _old_connection_log;`);
    db.exec(`
      CREATE TABLE connection_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
        client_id INTEGER REFERENCES clients(id),
        client_name TEXT NOT NULL,
        real_address TEXT NOT NULL,
        virtual_address TEXT NOT NULL,
        bytes_received INTEGER NOT NULL DEFAULT 0,
        bytes_sent INTEGER NOT NULL DEFAULT 0,
        connected_at TEXT NOT NULL,
        disconnected_at TEXT,
        duration_seconds INTEGER
      );
    `);
    db.run(
      `INSERT INTO connection_log (id, instance_id, client_id, client_name, real_address, virtual_address, bytes_received, bytes_sent, connected_at, disconnected_at, duration_seconds)
       SELECT id, ?, client_id, client_name, real_address, virtual_address, bytes_received, bytes_sent, connected_at, disconnected_at, duration_seconds
       FROM _old_connection_log`,
      [instanceId],
    );
    db.exec(`DROP TABLE _old_connection_log;`);

    // 6. Migrate setup_state
    db.exec(`ALTER TABLE setup_state RENAME TO _old_setup_state;`);
    db.exec(`
      CREATE TABLE setup_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id INTEGER NOT NULL UNIQUE REFERENCES instances(id) ON DELETE CASCADE,
        step TEXT NOT NULL DEFAULT 'none',
        completed INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        completed_at TEXT,
        error TEXT
      );
    `);
    db.run(
      `INSERT INTO setup_state (instance_id, step, completed, started_at, completed_at, error)
       SELECT ?, step, completed, started_at, completed_at, error
       FROM _old_setup_state WHERE id = 1`,
      [instanceId],
    );
    db.exec(`DROP TABLE _old_setup_state;`);

    // 7. Recreate indexes
    db.exec(`CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_clients_instance ON clients(instance_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_connection_log_client ON connection_log(client_name);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_connection_log_connected ON connection_log(connected_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_connection_log_instance ON connection_log(instance_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_instances_name ON instances(name);`);

    db.exec("COMMIT;");
    console.log("Migration complete.");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}
