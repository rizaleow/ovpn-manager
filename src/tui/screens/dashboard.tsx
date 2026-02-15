import { useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { Header } from "../components/header.tsx";
import { NavBar } from "../components/nav-bar.tsx";
import { StatusBadge } from "../components/status-badge.tsx";
import { Spinner } from "../components/spinner.tsx";
import { useRefresh } from "../hooks/use-refresh.ts";
import { colors } from "../theme.ts";
import type { Instance } from "../../types/index.ts";
import { InstanceService } from "../../services/instance.ts";
import type { AppConfig } from "../../types/index.ts";
import type { Screen } from "../hooks/use-navigation.ts";

interface DashboardProps {
  config: AppConfig;
  onNavigate: (screen: Screen) => void;
  onQuit: () => void;
}

export function Dashboard({ config, onNavigate, onQuit }: DashboardProps) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const instanceService = new InstanceService(config);

  const refresh = useCallback(() => {
    try {
      const list = instanceService.list();
      setInstances(list);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  useRefresh(refresh, 5000);

  useKeyboard((key) => {
    // Handle delete confirmation
    if (confirmDelete !== null) {
      if (key.name === "y") {
        const name = confirmDelete;
        setConfirmDelete(null);
        instanceService.delete(name).then(refresh);
      } else if (key.name === "n" || key.name === "escape") {
        setConfirmDelete(null);
      }
      return;
    }

    if (key.name === "q") {
      onQuit();
      return;
    }

    if (key.name === "n") {
      onNavigate({ name: "setup-wizard" });
      return;
    }

    if (key.name === "up" || key.name === "k") {
      setSelected((s) => Math.max(0, s - 1));
      return;
    }

    if (key.name === "down" || key.name === "j") {
      setSelected((s) => Math.min(instances.length - 1, s + 1));
      return;
    }

    if (key.name === "return" && instances.length > 0) {
      const inst = instances[selected];
      if (inst) {
        onNavigate({ name: "instance", instanceName: inst.name });
      }
      return;
    }

    if (key.name === "r") {
      refresh();
      return;
    }

    if (key.name === "d" && instances.length > 0) {
      const inst = instances[selected];
      if (inst) {
        setConfirmDelete(inst.name);
      }
      return;
    }
  });

  if (loading) {
    return (
      <box style={{ flexDirection: "column", padding: 1 }}>
        <Header title="OpenVPN Manager" />
        <Spinner label="Loading instances..." />
      </box>
    );
  }

  return (
    <box style={{ flexDirection: "column", padding: 1, gap: 1 }}>
      <Header title="OpenVPN Manager" />

      {instances.length === 0 ? (
        <box style={{ flexDirection: "column", gap: 1 }}>
          <text fg={colors.textDim}>No instances configured.</text>
          <text fg={colors.text}>Press [n] to create your first VPN instance.</text>
        </box>
      ) : (
        <box style={{ flexDirection: "column" }}>
          <text fg={colors.textDim}>
            {"  NAME              STATUS     CREATED"}
          </text>
          {instances.map((inst, i) => {
            const isSelected = i === selected;
            const name = inst.display_name ?? inst.name;
            return (
              <box key={inst.id} style={{ height: 1 }}>
                <text fg={isSelected ? colors.primary : colors.text}>
                  {isSelected ? "> " : "  "}
                  {name.padEnd(18)}
                </text>
                <StatusBadge status={inst.status} />
                <text fg={colors.textDim}>
                  {"  " + inst.created_at.slice(0, 10)}
                </text>
              </box>
            );
          })}
        </box>
      )}

      {confirmDelete !== null && (
        <text fg={colors.warning}>
          Delete "{confirmDelete}"? [y/N]
        </text>
      )}

      <NavBar
        shortcuts={[
          { key: "Enter", label: "Open" },
          { key: "n", label: "New" },
          { key: "d", label: "Delete" },
          { key: "r", label: "Refresh" },
          { key: "q", label: "Quit" },
        ]}
      />
    </box>
  );
}
