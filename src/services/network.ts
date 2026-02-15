import { exec, execShell } from "../utils/shell.ts";

export class NetworkService {
  async enableForwarding(): Promise<void> {
    await exec(["sysctl", "-w", "net.ipv4.ip_forward=1"]);
    await Bun.write(
      "/etc/sysctl.d/99-openvpn.conf",
      "net.ipv4.ip_forward = 1\n",
    );
  }

  async disableForwarding(): Promise<void> {
    await exec(["sysctl", "-w", "net.ipv4.ip_forward=0"]);
    const { unlinkSync } = await import("node:fs");
    try {
      unlinkSync("/etc/sysctl.d/99-openvpn.conf");
    } catch {
      // file may not exist
    }
  }

  async getForwardingStatus(): Promise<boolean> {
    const result = await exec(["sysctl", "-n", "net.ipv4.ip_forward"]);
    return result.trim() === "1";
  }

  async getDefaultInterface(): Promise<string> {
    const output = await exec(["ip", "route", "show", "default"]);
    // "default via 10.0.0.1 dev eth0 proto..."
    const match = output.match(/dev\s+(\S+)/);
    return match?.[1] ?? "eth0";
  }

  async setupNAT(subnet: string, subnetMask: string): Promise<void> {
    const iface = await this.getDefaultInterface();
    const cidr = this.maskToCidr(subnetMask);

    // POSTROUTING MASQUERADE
    await exec([
      "iptables", "-t", "nat", "-C", "POSTROUTING",
      "-s", `${subnet}/${cidr}`, "-o", iface, "-j", "MASQUERADE",
    ]).catch(() =>
      exec([
        "iptables", "-t", "nat", "-A", "POSTROUTING",
        "-s", `${subnet}/${cidr}`, "-o", iface, "-j", "MASQUERADE",
      ])
    );

    // FORWARD from VPN
    await exec([
      "iptables", "-C", "FORWARD",
      "-i", "tun0", "-o", iface, "-j", "ACCEPT",
    ]).catch(() =>
      exec([
        "iptables", "-A", "FORWARD",
        "-i", "tun0", "-o", iface, "-j", "ACCEPT",
      ])
    );

    // FORWARD to VPN (established)
    await exec([
      "iptables", "-C", "FORWARD",
      "-i", iface, "-o", "tun0",
      "-m", "state", "--state", "RELATED,ESTABLISHED", "-j", "ACCEPT",
    ]).catch(() =>
      exec([
        "iptables", "-A", "FORWARD",
        "-i", iface, "-o", "tun0",
        "-m", "state", "--state", "RELATED,ESTABLISHED", "-j", "ACCEPT",
      ])
    );
  }

  async persistIptables(): Promise<void> {
    await execShell("iptables-save > /etc/iptables/rules.v4");
  }

  async listNATRules(): Promise<string> {
    return await exec(["iptables", "-t", "nat", "-L", "POSTROUTING", "-n", "-v", "--line-numbers"]);
  }

  async listForwardRules(): Promise<string> {
    return await exec(["iptables", "-L", "FORWARD", "-n", "-v", "--line-numbers"]);
  }

  async deleteNATRule(ruleNum: number): Promise<void> {
    await exec(["iptables", "-t", "nat", "-D", "POSTROUTING", String(ruleNum)]);
  }

  async addIptablesRule(opts: {
    chain: string;
    source: string;
    destination?: string;
    outInterface?: string;
    target: string;
  }): Promise<void> {
    const args = ["iptables"];
    if (opts.chain === "POSTROUTING") {
      args.push("-t", "nat");
    }
    args.push("-A", opts.chain);
    args.push("-s", opts.source);
    if (opts.destination) args.push("-d", opts.destination);
    if (opts.outInterface) args.push("-o", opts.outInterface);
    args.push("-j", opts.target);
    await exec(args);
  }

  async listInterfaces(): Promise<string> {
    return await exec(["ip", "-j", "addr", "show"]);
  }

  private maskToCidr(mask: string): number {
    return mask
      .split(".")
      .reduce((bits, octet) => bits + (Number(octet) >>> 0).toString(2).replace(/0/g, "").length, 0);
  }
}
