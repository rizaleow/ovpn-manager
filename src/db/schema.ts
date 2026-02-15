import type { Database } from "bun:sqlite";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS instances (
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

CREATE TABLE IF NOT EXISTS server_config (
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

CREATE TABLE IF NOT EXISTS clients (
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

CREATE TABLE IF NOT EXISTS connection_log (
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

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT,
  details TEXT,
  ip_address TEXT NOT NULL DEFAULT '',
  success INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS setup_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id INTEGER NOT NULL UNIQUE REFERENCES instances(id) ON DELETE CASCADE,
  step TEXT NOT NULL DEFAULT 'none',
  completed INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  error TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_instance ON clients(instance_id);
CREATE INDEX IF NOT EXISTS idx_connection_log_client ON connection_log(client_name);
CREATE INDEX IF NOT EXISTS idx_connection_log_connected ON connection_log(connected_at);
CREATE INDEX IF NOT EXISTS idx_connection_log_instance ON connection_log(instance_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_instances_name ON instances(name);
`;

export function initSchema(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_SQL);
}
