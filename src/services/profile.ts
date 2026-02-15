import { PKIService } from "./pki.ts";
import { getDb } from "../db/index.ts";
import type { Instance } from "../types/index.ts";

export class ProfileService {
  private pki: PKIService;

  constructor(private instance: Instance) {
    this.pki = new PKIService(instance);
  }

  async generateProfile(clientName: string): Promise<string> {
    const db = getDb();
    const serverConfig: any = db.query("SELECT * FROM server_config WHERE instance_id = ?").get(this.instance.id);

    const ca = await this.pki.getCA();
    const cert = await this.pki.getClientCert(clientName);
    const key = await this.pki.getClientKey(clientName);

    const hostname = serverConfig.hostname;
    const port = serverConfig.port;
    const protocol = serverConfig.protocol;
    const devType = serverConfig.dev_type;
    const cipher = serverConfig.cipher;
    const auth = serverConfig.auth;
    const tlsAuth = serverConfig.tls_auth;
    const compress = serverConfig.compress;

    const lines: string[] = [
      "client",
      `dev ${devType}`,
      `proto ${protocol}`,
      `remote ${hostname} ${port}`,
      "resolv-retry infinite",
      "nobind",
      "persist-key",
      "persist-tun",
      "remote-cert-tls server",
      `cipher ${cipher}`,
      `auth ${auth}`,
      "verb 3",
      "",
    ];

    if (compress) {
      lines.push(`compress ${compress}`);
      lines.push("");
    }

    lines.push("key-direction 1");
    lines.push("");

    lines.push(`<ca>\n${ca.trim()}\n</ca>`);
    lines.push("");
    lines.push(`<cert>\n${cert.trim()}\n</cert>`);
    lines.push("");
    lines.push(`<key>\n${key.trim()}\n</key>`);
    lines.push("");

    if (tlsAuth) {
      const ta = await this.pki.getTLSAuth();
      lines.push(`<tls-auth>\n${ta.trim()}\n</tls-auth>`);
      lines.push("");
    }

    return lines.join("\n");
  }
}
