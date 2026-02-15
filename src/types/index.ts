export interface ListenConfig {
  host: string;
  port: number;
}

export interface VpnConfig {
  hostname: string;
  port: number;
  protocol: "udp" | "tcp";
  devType: "tun" | "tap";
  subnet: string;
  subnetMask: string;
  dns: string[];
  cipher: string;
}

export interface PathsConfig {
  easyrsaDir: string;
  serverConfigPath: string;
  statusFile: string;
  logFile: string;
  managementSocket: string;
  clientConfigDir: string;
}

export interface BasePaths {
  serverDir: string;
  logDir: string;
}

export interface AppConfig {
  listen: ListenConfig;
  apiKey: string;
  dbPath: string;
  vpn: VpnConfig;
  paths: PathsConfig;
  basePaths: BasePaths;
  logLevel: "debug" | "info" | "warn" | "error";
}

export interface Instance {
  id: number;
  name: string;
  display_name: string | null;
  status: "setup" | "active" | "inactive" | "error";
  easyrsa_dir: string;
  config_path: string;
  status_file: string;
  log_file: string;
  ccd_dir: string;
  created_at: string;
  updated_at: string;
}

export interface InstancePaths {
  easyrsaDir: string;
  configPath: string;
  statusFile: string;
  logFile: string;
  ccdDir: string;
}

export interface Client {
  id: number;
  instance_id: number;
  name: string;
  email: string | null;
  status: "active" | "revoked" | "expired";
  cert_cn: string;
  static_ip: string | null;
  created_at: string;
  revoked_at: string | null;
  expires_at: string | null;
  notes: string | null;
}

export interface ConnectionLog {
  id: number;
  instance_id: number | null;
  client_id: number | null;
  client_name: string;
  real_address: string;
  virtual_address: string;
  bytes_received: number;
  bytes_sent: number;
  connected_at: string;
  disconnected_at: string | null;
  duration_seconds: number | null;
}

export interface AuditLog {
  id: number;
  timestamp: string;
  action: string;
  resource: string;
  resource_id: string | null;
  details: string | null;
  ip_address: string;
  success: boolean;
}

export interface SetupState {
  step: "none" | "packages_installed" | "pki_initialized" | "server_configured" | "network_configured" | "running";
  completed: boolean;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export interface ActiveConnection {
  commonName: string;
  realAddress: string;
  virtualAddress: string;
  virtualIPv6Address: string;
  bytesReceived: number;
  bytesSent: number;
  connectedSince: string;
}

export interface ServerStatus {
  active: boolean;
  uptime: string | null;
  connections: number;
}
