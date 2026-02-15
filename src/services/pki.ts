import { exec } from "../utils/shell.ts";
import type { Instance } from "../types/index.ts";

const EASYRSA_BIN = "/usr/share/easy-rsa/easyrsa";

export class PKIService {
  private pkiDir: string;
  private easyrsaDir: string;

  constructor(private instance: Instance) {
    this.easyrsaDir = instance.easyrsa_dir;
    this.pkiDir = `${this.easyrsaDir}/pki`;
  }

  private async easyrsa(...args: string[]): Promise<string> {
    return exec([EASYRSA_BIN, "--batch", `--pki-dir=${this.pkiDir}`, ...args]);
  }

  async initPKI(): Promise<void> {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(this.easyrsaDir, { recursive: true });
    await this.easyrsa("init-pki");
  }

  async buildCA(): Promise<void> {
    await exec([
      EASYRSA_BIN,
      "--batch",
      `--pki-dir=${this.pkiDir}`,
      "--req-cn=OpenVPN-CA",
      "build-ca",
      "nopass",
    ]);
  }

  async genServerCert(name = "server"): Promise<void> {
    await this.easyrsa("build-server-full", name, "nopass");
  }

  async genClientCert(name: string): Promise<void> {
    await this.easyrsa("build-client-full", name, "nopass");
  }

  async revokeCert(name: string): Promise<void> {
    await this.easyrsa("revoke", name);
    await this.genCRL();
  }

  async genCRL(): Promise<void> {
    await this.easyrsa("gen-crl");
  }

  async genDH(): Promise<void> {
    await this.easyrsa("gen-dh");
  }

  async genTLSAuth(): Promise<void> {
    const taKeyPath = `${this.pkiDir}/ta.key`;
    await exec(["openvpn", "--genkey", "secret", taKeyPath]);
  }

  async getCA(): Promise<string> {
    return await Bun.file(`${this.pkiDir}/ca.crt`).text();
  }

  async getClientCert(name: string): Promise<string> {
    return await Bun.file(`${this.pkiDir}/issued/${name}.crt`).text();
  }

  async getClientKey(name: string): Promise<string> {
    return await Bun.file(`${this.pkiDir}/private/${name}.key`).text();
  }

  async getTLSAuth(): Promise<string> {
    return await Bun.file(`${this.pkiDir}/ta.key`).text();
  }

  async getDHPath(): Promise<string> {
    return `${this.pkiDir}/dh.pem`;
  }

  async getCRLPath(): Promise<string> {
    return `${this.pkiDir}/crl.pem`;
  }

  async getCACertPath(): Promise<string> {
    return `${this.pkiDir}/ca.crt`;
  }

  async getServerCertPath(name = "server"): Promise<string> {
    return `${this.pkiDir}/issued/${name}.crt`;
  }

  async getServerKeyPath(name = "server"): Promise<string> {
    return `${this.pkiDir}/private/${name}.key`;
  }

  async getTLSAuthPath(): Promise<string> {
    return `${this.pkiDir}/ta.key`;
  }
}
