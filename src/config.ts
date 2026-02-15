import type { AppConfig } from "./types/index.ts";

const DEFAULT_CONFIG: AppConfig = {
  listen: { host: "127.0.0.1", port: 3000 },
  apiKey: "",
  dbPath: "/etc/ovpn-manager/ovpn-manager.db",
  basePaths: {
    serverDir: "/etc/openvpn/server",
    logDir: "/var/log/openvpn",
  },
  logLevel: "info",
};

export function resolveConfigPath(override?: string): string {
  if (override) return override;

  const args = process.argv;
  const configIdx = args.indexOf("--config");
  if (configIdx !== -1 && args[configIdx + 1] !== undefined) {
    return args[configIdx + 1]!;
  }
  if (process.env.OVPN_MANAGER_CONFIG) {
    return process.env.OVPN_MANAGER_CONFIG;
  }
  return "/etc/ovpn-manager/config.json";
}

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export async function configExists(overridePath?: string): Promise<boolean> {
  const configPath = resolveConfigPath(overridePath);
  return await Bun.file(configPath).exists();
}

export async function loadConfig(overridePath?: string): Promise<AppConfig> {
  const configPath = resolveConfigPath(overridePath);
  let fileConfig: Partial<AppConfig> = {};

  const file = Bun.file(configPath);
  if (await file.exists()) {
    fileConfig = await file.json();
  } else {
    console.log(`Config file not found at ${configPath}, using defaults`);
  }

  const config = deepMerge(DEFAULT_CONFIG, fileConfig as Record<string, any>) as AppConfig;

  // Auto-generate API key if empty
  if (!config.apiKey) {
    config.apiKey = crypto.randomUUID();
    console.log(`Generated API key: ${config.apiKey}`);

    // Try to write back
    try {
      const dir = configPath.substring(0, configPath.lastIndexOf("/"));
      const { mkdirSync } = await import("node:fs");
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        // dir may already exist
      }
      await Bun.write(configPath, JSON.stringify(config, null, 2) + "\n");
      console.log(`Config written to ${configPath}`);
    } catch {
      console.warn(`Could not write config to ${configPath} — using in-memory config`);
    }
  }

  return config;
}
