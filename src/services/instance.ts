import { getDb } from "../db/index.ts";
import type { AppConfig, Instance, InstancePaths } from "../types/index.ts";

export class InstanceService {
  constructor(private config: AppConfig) {}

  derivePaths(name: string): InstancePaths {
    const serverDir = this.config.basePaths.serverDir;
    const logDir = this.config.basePaths.logDir;
    return {
      easyrsaDir: `${serverDir}/${name}/easy-rsa`,
      configPath: `${serverDir}/${name}.conf`,
      statusFile: `${logDir}/${name}-status.log`,
      logFile: `${logDir}/${name}.log`,
      ccdDir: `${serverDir}/${name}/ccd`,
    };
  }

  async create(name: string, displayName?: string): Promise<Instance> {
    const db = getDb();
    const paths = this.derivePaths(name);

    // Create directories
    const { mkdirSync } = await import("node:fs");
    mkdirSync(paths.easyrsaDir, { recursive: true });
    mkdirSync(paths.ccdDir, { recursive: true });
    const logDir = paths.logFile.substring(0, paths.logFile.lastIndexOf("/"));
    mkdirSync(logDir, { recursive: true });

    db.run(
      `INSERT INTO instances (name, display_name, easyrsa_dir, config_path, status_file, log_file, ccd_dir)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        displayName ?? null,
        paths.easyrsaDir,
        paths.configPath,
        paths.statusFile,
        paths.logFile,
        paths.ccdDir,
      ],
    );

    const instance = db.query("SELECT * FROM instances WHERE name = ?").get(name) as Instance;

    // Create associated server_config and setup_state rows
    db.run(`INSERT INTO server_config (instance_id) VALUES (?)`, [instance.id]);
    db.run(`INSERT INTO setup_state (instance_id, step, completed) VALUES (?, 'none', 0)`, [instance.id]);

    return instance;
  }

  list(): Instance[] {
    const db = getDb();
    return db.query("SELECT * FROM instances ORDER BY created_at ASC").all() as Instance[];
  }

  get(name: string): Instance | null {
    const db = getDb();
    return db.query("SELECT * FROM instances WHERE name = ?").get(name) as Instance | null;
  }

  getById(id: number): Instance | null {
    const db = getDb();
    return db.query("SELECT * FROM instances WHERE id = ?").get(id) as Instance | null;
  }

  async delete(name: string): Promise<void> {
    const db = getDb();
    const instance = this.get(name);
    if (!instance) return;

    // Stop the OpenVPN service for this instance
    const { exec } = await import("../utils/shell.ts");
    try {
      await exec(["systemctl", "stop", `openvpn-server@${name}`]);
    } catch {
      // May not be running
    }
    try {
      await exec(["systemctl", "disable", `openvpn-server@${name}`]);
    } catch {
      // May not be enabled
    }

    // Remove filesystem artifacts
    const { rmSync } = await import("node:fs");
    try { rmSync(instance.easyrsa_dir, { recursive: true, force: true }); } catch {}
    try { rmSync(instance.ccd_dir, { recursive: true, force: true }); } catch {}
    try { rmSync(instance.config_path, { force: true }); } catch {}
    try { rmSync(instance.status_file, { force: true }); } catch {}
    try { rmSync(instance.log_file, { force: true }); } catch {}

    // Delete from DB (cascades to server_config, clients, connection_log, setup_state)
    db.run("DELETE FROM instances WHERE id = ?", [instance.id]);
  }

  updateStatus(name: string, status: Instance["status"]): void {
    const db = getDb();
    db.run("UPDATE instances SET status = ?, updated_at = datetime('now') WHERE name = ?", [status, name]);
  }
}
