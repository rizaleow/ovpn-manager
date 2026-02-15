import { loadConfig } from "../config.ts";
import { initDb } from "../db/index.ts";
import { SystemSetupService } from "../services/system-setup.ts";

export async function runSetup(configPath?: string): Promise<void> {
  console.log("OpenVPN Manager — First-Time Setup\n");

  // Check root
  if (process.getuid && process.getuid() !== 0) {
    console.error("Error: Setup must be run as root (sudo ovpn-manager setup)");
    process.exit(1);
  }

  const systemSetup = new SystemSetupService();

  // Step 1: Install system dependencies
  console.log("[1/4] Installing system dependencies...");
  await systemSetup.installDependencies();
  console.log("  Dependencies installed.\n");

  // Step 2: Create config directory + default config
  console.log("[2/4] Creating configuration...");
  await systemSetup.createConfigDirectory();
  const config = await loadConfig(configPath);
  console.log(`  Config: ${configPath ?? "/etc/ovpn-manager/config.json"}\n`);

  // Step 3: Initialize database
  console.log("[3/4] Initializing database...");
  initDb(config.dbPath);
  console.log(`  Database: ${config.dbPath}\n`);

  // Step 4: Install + start systemd service
  console.log("[4/4] Installing systemd service...");
  await systemSetup.installSystemdService();
  console.log("  Service installed and enabled.\n");

  console.log("Setup complete!");
  console.log(`  API key: ${config.apiKey}`);
  console.log(`  API:     http://${config.listen.host}:${config.listen.port}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Create an instance:  ovpn-manager tui");
  console.log("     Or via API:          POST /api/instances");
  console.log("  2. Run setup on it:     POST /api/instances/{name}/setup");
  console.log("");
}
