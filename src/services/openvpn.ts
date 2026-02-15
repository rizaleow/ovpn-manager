import { exec } from "../utils/shell.ts";
import type { Instance } from "../types/index.ts";
import { getDb } from "../db/index.ts";
import { PKIService } from "./pki.ts";

export class OpenVPNService {
  private pki: PKIService;
  private serviceName: string;

  constructor(private instance: Instance) {
    this.pki = new PKIService(instance);
    this.serviceName = `openvpn-server@${instance.name}`;
  }

  async start(): Promise<void> {
    await exec(["systemctl", "start", this.serviceName]);
  }

  async stop(): Promise<void> {
    await exec(["systemctl", "stop", this.serviceName]);
  }

  async restart(): Promise<void> {
    await exec(["systemctl", "restart", this.serviceName]);
  }

  async enable(): Promise<void> {
    await exec(["systemctl", "enable", this.serviceName]);
  }

  async isActive(): Promise<boolean> {
    try {
      const result = await exec(["systemctl", "is-active", this.serviceName]);
      return result.trim() === "active";
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<{ active: boolean; output: string }> {
    try {
      const output = await exec(["systemctl", "status", this.serviceName]);
      return { active: true, output };
    } catch (e: any) {
      return { active: false, output: e.stderr || e.message };
    }
  }

  async getLogs(lines = 100): Promise<string> {
    try {
      return await exec(["tail", "-n", String(lines), this.instance.log_file]);
    } catch {
      // Fallback to journalctl
      return await exec(["journalctl", "-u", this.serviceName, "-n", String(lines), "--no-pager"]);
    }
  }

  async generateServerConfig(overrides?: Record<string, any>): Promise<string> {
    const db = getDb();
    const row: any = db.query("SELECT * FROM server_config WHERE instance_id = ?").get(this.instance.id);

    const port = overrides?.port ?? row.port;
    const protocol = overrides?.protocol ?? row.protocol;
    const devType = overrides?.dev_type ?? row.dev_type;
    const subnet = overrides?.subnet ?? row.subnet;
    const subnetMask = overrides?.subnet_mask ?? row.subnet_mask;
    const dns: string[] = JSON.parse(overrides?.dns ?? row.dns);
    const cipher = overrides?.cipher ?? row.cipher;
    const auth = overrides?.auth ?? row.auth;
    const tlsAuth = overrides?.tls_auth ?? row.tls_auth;
    const compress = overrides?.compress ?? row.compress;
    const clientToClient = overrides?.client_to_client ?? row.client_to_client;
    const maxClients = overrides?.max_clients ?? row.max_clients;
    const keepalive = overrides?.keepalive ?? row.keepalive;

    const caPath = await this.pki.getCACertPath();
    const serverCertPath = await this.pki.getServerCertPath();
    const serverKeyPath = await this.pki.getServerKeyPath();
    const dhPath = await this.pki.getDHPath();
    const crlPath = await this.pki.getCRLPath();
    const taPath = await this.pki.getTLSAuthPath();

    const lines: string[] = [
      `port ${port}`,
      `proto ${protocol}`,
      `dev ${devType}`,
      "",
      `ca ${caPath}`,
      `cert ${serverCertPath}`,
      `key ${serverKeyPath}`,
      `dh ${dhPath}`,
      `crl-verify ${crlPath}`,
      "",
    ];

    if (devType === "tun") {
      lines.push(`server ${subnet} ${subnetMask}`);
    } else {
      lines.push(`server-bridge`);
    }
    lines.push("");

    lines.push(`ifconfig-pool-persist /var/log/openvpn/${this.instance.name}-ipp.txt`);
    lines.push(`client-config-dir ${this.instance.ccd_dir}`);
    lines.push("");

    for (const d of dns) {
      lines.push(`push "dhcp-option DNS ${d}"`);
    }
    lines.push(`push "redirect-gateway def1 bypass-dhcp"`);
    lines.push("");

    if (clientToClient) {
      lines.push("client-to-client");
    }

    lines.push(`keepalive ${keepalive}`);
    lines.push("");

    if (tlsAuth) {
      lines.push(`tls-auth ${taPath} 0`);
    }

    lines.push(`cipher ${cipher}`);
    lines.push(`auth ${auth}`);
    lines.push("");

    if (compress) {
      lines.push(`compress ${compress}`);
      lines.push(`push "compress ${compress}"`);
    }

    lines.push(`max-clients ${maxClients}`);
    lines.push("");
    lines.push("user nobody");
    lines.push("group nogroup");
    lines.push("");
    lines.push("persist-key");
    lines.push("persist-tun");
    lines.push("");
    lines.push(`status ${this.instance.status_file} 10`);
    lines.push(`log-append ${this.instance.log_file}`);
    lines.push("verb 3");
    lines.push("mute 20");
    lines.push("");
    lines.push("explicit-exit-notify 1");

    return lines.join("\n") + "\n";
  }

  async writeServerConfig(): Promise<void> {
    const conf = await this.generateServerConfig();
    await Bun.write(this.instance.config_path, conf);
  }
}
