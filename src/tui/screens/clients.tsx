import { useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { Header } from "../components/header.tsx";
import { NavBar } from "../components/nav-bar.tsx";
import { Spinner } from "../components/spinner.tsx";
import { useRefresh } from "../hooks/use-refresh.ts";
import { colors } from "../theme.ts";
import type { AppConfig, Client } from "../../types/index.ts";
import { InstanceService } from "../../services/instance.ts";
import { PKIService } from "../../services/pki.ts";
import { OpenVPNService } from "../../services/openvpn.ts";
import { ProfileService } from "../../services/profile.ts";
import { getDb } from "../../db/index.ts";

interface ClientsScreenProps {
  config: AppConfig;
  instanceName: string;
  onBack: () => void;
}

const PAGE_SIZE = 20;

export function ClientsScreen({ config, instanceName, onBack }: ClientsScreenProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState("");
  const [creating, setCreating] = useState(false);
  const [newClientName, setNewClientName] = useState("");

  const instanceService = new InstanceService(config);

  const refresh = useCallback(() => {
    const inst = instanceService.get(instanceName);
    if (!inst) { onBack(); return; }
    const db = getDb();
    const rows = db.query("SELECT * FROM clients WHERE instance_id = ? ORDER BY created_at DESC").all(inst.id) as Client[];
    setClients(rows);
    setLoading(false);
  }, [instanceName]);

  useRefresh(refresh, 5000);

  useKeyboard(async (key) => {
    if (creating) {
      if (key.name === "escape") {
        setCreating(false);
        setNewClientName("");
        return;
      }
      return; // Let input handle other keys
    }

    if (key.name === "escape" || key.name === "backspace") {
      onBack();
      return;
    }

    if (key.name === "up" || key.name === "k") {
      setSelected((s) => Math.max(0, s - 1));
      return;
    }

    if (key.name === "down" || key.name === "j") {
      setSelected((s) => Math.min(clients.length - 1, s + 1));
      return;
    }

    if (key.name === "n") {
      setCreating(true);
      return;
    }

    const inst = instanceService.get(instanceName);
    if (!inst) return;

    if (key.name === "d" && clients.length > 0) {
      const client = clients[selected];
      if (!client || client.status === "revoked") return;

      try {
        setActionMsg(`Revoking ${client.name}...`);
        const pki = new PKIService(inst);
        await pki.revokeCert(client.name);
        const db = getDb();
        db.run("UPDATE clients SET status = 'revoked', revoked_at = datetime('now') WHERE instance_id = ? AND name = ?", [inst.id, client.name]);
        const openvpn = new OpenVPNService(inst);
        try { await openvpn.restart(); } catch (err) {
          console.error("Failed to restart OpenVPN:", err);
        }
        setActionMsg(`Revoked ${client.name}`);
        refresh();
      } catch (err) {
        setActionMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (key.name === "p" && clients.length > 0) {
      const client = clients[selected];
      if (!client || client.status === "revoked") return;

      try {
        const profile = new ProfileService(inst);
        const ovpn = await profile.generateProfile(client.name);
        const outPath = `${process.env.HOME ?? process.cwd()}/${client.name}.ovpn`;
        await Bun.write(outPath, ovpn);
        setActionMsg(`Profile saved: ${outPath}`);
      } catch (err) {
        setActionMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (key.name === "r") {
      refresh();
      return;
    }

    // Pagination
    if (key.sequence === "]") {
      const maxPage = Math.max(0, Math.ceil(clients.length / PAGE_SIZE) - 1);
      if (page < maxPage) {
        setPage((p) => p + 1);
        setSelected(0);
      }
      return;
    }

    if (key.sequence === "[") {
      if (page > 0) {
        setPage((p) => p - 1);
        setSelected(0);
      }
      return;
    }
  });

  const handleCreateSubmit = useCallback(async () => {
    const name = newClientName.trim();
    if (!name) return;

    const inst = instanceService.get(instanceName);
    if (!inst) return;

    try {
      setActionMsg(`Creating ${name}...`);
      const pki = new PKIService(inst);
      await pki.genClientCert(name);
      const db = getDb();
      db.run(
        "INSERT INTO clients (instance_id, name, cert_cn) VALUES (?, ?, ?)",
        [inst.id, name, name],
      );
      setActionMsg(`Created ${name}`);
      setCreating(false);
      setNewClientName("");
      refresh();
    } catch (err) {
      setActionMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setCreating(false);
    }
  }, [newClientName, instanceName]);

  if (loading) {
    return (
      <box style={{ flexDirection: "column", padding: 1 }}>
        <Header title="Clients" breadcrumb={["Dashboard", instanceName]} />
        <Spinner label="Loading clients..." />
      </box>
    );
  }

  return (
    <box style={{ flexDirection: "column", padding: 1, gap: 1 }}>
      <Header title="Clients" breadcrumb={["Dashboard", instanceName]} />

      {creating && (
        <box style={{ flexDirection: "column", gap: 1 }}>
          <text fg={colors.text}>Client name:</text>
          <box style={{ border: true, height: 3, borderColor: colors.primary }}>
            <input
              placeholder="e.g. john-laptop"
              onInput={setNewClientName}
              onSubmit={handleCreateSubmit}
              focused
            />
          </box>
          <text fg={colors.textDim}>Press Enter to create, Esc to cancel</text>
        </box>
      )}

      {!creating && clients.length === 0 && (
        <text fg={colors.textDim}>No clients. Press [n] to create one.</text>
      )}

      {!creating && clients.length > 0 && (() => {
        const totalPages = Math.ceil(clients.length / PAGE_SIZE);
        const pageClients = clients.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        return (
          <box style={{ flexDirection: "column" }}>
            <text fg={colors.textDim}>
              {"  NAME                STATUS    CREATED"}
              {totalPages > 1 ? `  (Page ${page + 1}/${totalPages})` : ""}
            </text>
            {pageClients.map((client, i) => {
              const isSelected = i === selected;
              const statusColor = client.status === "active" ? colors.success : client.status === "revoked" ? colors.error : colors.warning;
              return (
                <box key={client.id} style={{ height: 1 }}>
                  <text fg={isSelected ? colors.primary : colors.text}>
                    {isSelected ? "> " : "  "}
                    {client.name.padEnd(20)}
                  </text>
                  <text fg={statusColor}>{client.status.padEnd(10)}</text>
                  <text fg={colors.textDim}>{client.created_at.slice(0, 10)}</text>
                </box>
              );
            })}
          </box>
        );
      })()}

      {actionMsg && <text fg={colors.warning}>{actionMsg}</text>}

      <NavBar
        shortcuts={[
          { key: "n", label: "New" },
          { key: "d", label: "Revoke" },
          { key: "p", label: "Save Profile" },
          { key: "[/]", label: "Page" },
          { key: "r", label: "Refresh" },
          { key: "Esc", label: "Back" },
        ]}
      />
    </box>
  );
}
