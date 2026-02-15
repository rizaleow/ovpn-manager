import type { AppConfig, ActiveConnection } from "../types/index.ts";
import { getDb } from "../db/index.ts";

export class StatusMonitor {
  constructor(private config: AppConfig) {}

  async getActiveConnections(): Promise<ActiveConnection[]> {
    const statusFile = this.config.paths.statusFile;
    const file = Bun.file(statusFile);

    if (!(await file.exists())) {
      return [];
    }

    const content = await file.text();
    return this.parseStatusFile(content);
  }

  private parseStatusFile(content: string): ActiveConnection[] {
    const connections: ActiveConnection[] = [];
    const lines = content.split("\n");
    let inClientList = false;

    for (const line of lines) {
      if (line.startsWith("HEADER,CLIENT_LIST")) {
        inClientList = true;
        continue;
      }
      if (line.startsWith("HEADER,") && !line.startsWith("HEADER,CLIENT_LIST")) {
        inClientList = false;
        continue;
      }
      if (line.startsWith("END")) {
        break;
      }

      if (inClientList && line.startsWith("CLIENT_LIST,")) {
        const parts = line.split(",");
        // CLIENT_LIST,CN,Real Address,Virtual Address,Virtual IPv6 Address,Bytes Received,Bytes Sent,Connected Since,...
        if (parts.length >= 8) {
          connections.push({
            commonName: parts[1] ?? "",
            realAddress: parts[2] ?? "",
            virtualAddress: parts[3] ?? "",
            virtualIPv6Address: parts[4] ?? "",
            bytesReceived: parseInt(parts[5] ?? "0", 10) || 0,
            bytesSent: parseInt(parts[6] ?? "0", 10) || 0,
            connectedSince: parts[7] ?? "",
          });
        }
      }

      // Also handle the older tab-separated format
      if (inClientList && !line.startsWith("CLIENT_LIST,") && !line.startsWith("HEADER") && line.includes(",")) {
        const parts = line.split(",");
        if (parts.length >= 5) {
          connections.push({
            commonName: parts[0] ?? "",
            realAddress: parts[1] ?? "",
            virtualAddress: parts[2] ?? "",
            virtualIPv6Address: parts[3] ?? "",
            bytesReceived: parseInt(parts[4] ?? "0", 10) || 0,
            bytesSent: parseInt(parts[5] ?? "0", 10) || 0,
            connectedSince: parts[6] ?? "",
          });
        }
      }
    }

    return connections;
  }

  async recordSnapshot(): Promise<void> {
    const connections = await this.getActiveConnections();
    const db = getDb();

    const insert = db.prepare(
      `INSERT OR REPLACE INTO connection_log (client_name, real_address, virtual_address, bytes_received, bytes_sent, connected_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    for (const conn of connections) {
      insert.run(
        conn.commonName,
        conn.realAddress,
        conn.virtualAddress,
        conn.bytesReceived,
        conn.bytesSent,
        conn.connectedSince,
      );
    }
  }

  async getConnectionHistory(page = 1, limit = 20): Promise<{ rows: any[]; total: number }> {
    const db = getDb();
    const offset = (page - 1) * limit;

    const rows = db
      .query(
        `SELECT * FROM connection_log ORDER BY connected_at DESC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset);

    const total = (db.query("SELECT COUNT(*) as count FROM connection_log").get() as any).count;

    return { rows, total };
  }

  async getBandwidthStats(): Promise<any[]> {
    const db = getDb();
    return db
      .query(
        `SELECT client_name,
                SUM(bytes_received) as total_received,
                SUM(bytes_sent) as total_sent,
                COUNT(*) as connection_count,
                MAX(connected_at) as last_connected
         FROM connection_log
         GROUP BY client_name
         ORDER BY total_received DESC`,
      )
      .all();
  }
}
