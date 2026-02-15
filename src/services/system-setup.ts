import { exec } from "../utils/shell.ts";

const CONFIG_DIR = "/etc/ovpn-manager";
const SERVICE_FILE = "/etc/systemd/system/ovpn-manager.service";
const BINARY_PATH = "/usr/local/bin/ovpn-manager";

export class SystemSetupService {
  async checkDependencies(): Promise<{ openvpn: boolean; easyrsa: boolean; iptables: boolean }> {
    const check = async (cmd: string) => {
      try {
        await exec(["which", cmd]);
        return true;
      } catch {
        return false;
      }
    };

    return {
      openvpn: await check("openvpn"),
      easyrsa: await check("easyrsa"),
      iptables: await check("iptables"),
    };
  }

  async installDependencies(): Promise<void> {
    await exec(["apt-get", "update", "-qq"]);
    await exec(["apt-get", "install", "-y", "openvpn", "easy-rsa", "iptables-persistent"]);
  }

  async installSystemdService(): Promise<void> {
    const unit = `[Unit]
Description=OpenVPN Manager API
After=network.target

[Service]
Type=simple
ExecStart=${BINARY_PATH} serve --config ${CONFIG_DIR}/config.json
Restart=on-failure
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
`;
    await Bun.write(SERVICE_FILE, unit);
    await exec(["systemctl", "daemon-reload"]);
    await exec(["systemctl", "enable", "ovpn-manager"]);
  }

  async createConfigDirectory(): Promise<void> {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(CONFIG_DIR, { recursive: true });

    const configFile = `${CONFIG_DIR}/config.json`;
    const file = Bun.file(configFile);
    if (!(await file.exists())) {
      const defaultConfig = {
        listen: { host: "127.0.0.1", port: 3000 },
        apiKey: "",
        dbPath: `${CONFIG_DIR}/ovpn-manager.db`,
        vpn: {
          hostname: "vpn.example.com",
          port: 1194,
          protocol: "udp",
          devType: "tun",
          subnet: "10.8.0.0",
          subnetMask: "255.255.255.0",
          dns: ["1.1.1.1", "1.0.0.1"],
          cipher: "AES-256-GCM",
        },
        paths: {
          easyrsaDir: "/etc/openvpn/easy-rsa",
          serverConfigPath: "/etc/openvpn/server.conf",
          statusFile: "/var/log/openvpn/status.log",
          logFile: "/var/log/openvpn/openvpn.log",
          managementSocket: "/var/run/openvpn/management.sock",
          clientConfigDir: "/etc/openvpn/ccd",
        },
        basePaths: {
          serverDir: "/etc/openvpn/server",
          logDir: "/var/log/openvpn",
        },
        logLevel: "info",
      };
      await Bun.write(configFile, JSON.stringify(defaultConfig, null, 2) + "\n");
    }
  }

  isFirstRun(): boolean {
    try {
      const { existsSync } = require("node:fs");
      return !existsSync(`${CONFIG_DIR}/config.json`);
    } catch {
      return true;
    }
  }
}

export async function runUninstall(): Promise<void> {
  console.log("OpenVPN Manager — Uninstall\n");

  // Stop and disable service
  try {
    await exec(["systemctl", "stop", "ovpn-manager"]);
    console.log("  Service stopped.");
  } catch {}
  try {
    await exec(["systemctl", "disable", "ovpn-manager"]);
    console.log("  Service disabled.");
  } catch {}

  // Remove binary
  const { unlinkSync, rmSync } = await import("node:fs");
  try {
    unlinkSync(BINARY_PATH);
    console.log("  Binary removed.");
  } catch {}

  // Remove service file
  try {
    unlinkSync(SERVICE_FILE);
    await exec(["systemctl", "daemon-reload"]);
    console.log("  Service file removed.");
  } catch {}

  // Ask about config/data if TTY
  if (process.stdin.isTTY) {
    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question(`\nRemove config and data at ${CONFIG_DIR}? [y/N] `, resolve);
    });
    rl.close();

    if (answer.toLowerCase() === "y") {
      try {
        rmSync(CONFIG_DIR, { recursive: true, force: true });
        console.log("  Config and data removed.");
      } catch {}
    } else {
      console.log(`  Config preserved at ${CONFIG_DIR}`);
    }
  }

  console.log("\nUninstall complete!");
}
