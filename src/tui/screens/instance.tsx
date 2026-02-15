import { useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { Header } from "../components/header.tsx";
import { NavBar } from "../components/nav-bar.tsx";
import { StatusBadge } from "../components/status-badge.tsx";
import { Spinner } from "../components/spinner.tsx";
import { useRefresh } from "../hooks/use-refresh.ts";
import { colors } from "../theme.ts";
import type { AppConfig, Instance as InstanceType } from "../../types/index.ts";
import { InstanceService } from "../../services/instance.ts";
import { OpenVPNService } from "../../services/openvpn.ts";
import { StatusMonitor } from "../../services/status-monitor.ts";
import { getDb } from "../../db/index.ts";
import type { Screen } from "../hooks/use-navigation.ts";

interface InstanceScreenProps {
  config: AppConfig;
  instanceName: string;
  onNavigate: (screen: Screen) => void;
  onBack: () => void;
}

interface InstanceInfo {
  instance: InstanceType;
  active: boolean;
  connectionCount: number;
  clientCount: number;
}

export function InstanceScreen({ config, instanceName, onNavigate, onBack }: InstanceScreenProps) {
  const [info, setInfo] = useState<InstanceInfo | null>(null);
  const [actionMsg, setActionMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const instanceService = new InstanceService(config);

  const refresh = useCallback(async () => {
    const inst = instanceService.get(instanceName);
    if (!inst) {
      onBack();
      return;
    }
    const openvpn = new OpenVPNService(inst);
    const monitor = new StatusMonitor(inst);
    const db = getDb();

    const [active, connections] = await Promise.all([
      openvpn.isActive(),
      monitor.getActiveConnections(),
    ]);

    const clientCount = (db.query("SELECT COUNT(*) as count FROM clients WHERE instance_id = ?").get(inst.id) as any).count;

    setInfo({ instance: inst, active, connectionCount: connections.length, clientCount });
    setLoading(false);
  }, [instanceName]);

  useRefresh(refresh, 5000);

  useKeyboard(async (key) => {
    if (key.name === "escape" || key.name === "backspace") {
      onBack();
      return;
    }

    if (!info) return;

    if (key.name === "c") {
      onNavigate({ name: "clients", instanceName });
      return;
    }

    if (key.name === "l") {
      onNavigate({ name: "logs", instanceName });
      return;
    }

    if (key.name === "s") {
      const openvpn = new OpenVPNService(info.instance);
      try {
        if (info.active) {
          setActionMsg("Stopping...");
          await openvpn.stop();
          instanceService.updateStatus(instanceName, "inactive");
          setActionMsg("Stopped.");
        } else {
          setActionMsg("Starting...");
          await openvpn.start();
          instanceService.updateStatus(instanceName, "active");
          setActionMsg("Started.");
        }
        refresh();
      } catch (err: any) {
        setActionMsg(`Error: ${err.message}`);
      }
      return;
    }

    if (key.name === "x") {
      const openvpn = new OpenVPNService(info.instance);
      try {
        setActionMsg("Restarting...");
        await openvpn.restart();
        setActionMsg("Restarted.");
        refresh();
      } catch (err: any) {
        setActionMsg(`Error: ${err.message}`);
      }
      return;
    }
  });

  if (loading || !info) {
    return (
      <box style={{ flexDirection: "column", padding: 1 }}>
        <Header title={instanceName} breadcrumb={["Dashboard"]} />
        <Spinner label="Loading instance..." />
      </box>
    );
  }

  const { instance, active, connectionCount, clientCount } = info;

  return (
    <box style={{ flexDirection: "column", padding: 1, gap: 1 }}>
      <Header title={instance.display_name ?? instance.name} breadcrumb={["Dashboard"]} />

      <box style={{ flexDirection: "column" }}>
        <text fg={colors.text}>
          Status: <StatusBadge status={active ? "active" : "inactive"} />
        </text>
        <text fg={colors.text}>Connections:  {connectionCount}</text>
        <text fg={colors.text}>Clients:      {clientCount}</text>
        <text fg={colors.textDim}>Config:       {instance.config_path}</text>
        <text fg={colors.textDim}>PKI:          {instance.easyrsa_dir}</text>
        <text fg={colors.textDim}>Created:      {instance.created_at}</text>
      </box>

      {actionMsg && (
        <text fg={colors.warning}>{actionMsg}</text>
      )}

      <NavBar
        shortcuts={[
          { key: "s", label: active ? "Stop" : "Start" },
          { key: "x", label: "Restart" },
          { key: "c", label: "Clients" },
          { key: "l", label: "Logs" },
          { key: "Esc", label: "Back" },
        ]}
      />
    </box>
  );
}
