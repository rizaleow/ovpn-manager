import { useState, useCallback } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { Header } from "../components/header.tsx";
import { NavBar } from "../components/nav-bar.tsx";
import { Spinner } from "../components/spinner.tsx";
import { useRefresh } from "../hooks/use-refresh.ts";
import { colors } from "../theme.ts";
import type { AppConfig } from "../../types/index.ts";
import { InstanceService } from "../../services/instance.ts";
import { OpenVPNService } from "../../services/openvpn.ts";

interface LogsScreenProps {
  config: AppConfig;
  instanceName: string;
  onBack: () => void;
}

export function LogsScreen({ config, instanceName, onBack }: LogsScreenProps) {
  const [logLines, setLogLines] = useState<string[]>([]);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [userScrolled, setUserScrolled] = useState(false);
  const { height } = useTerminalDimensions();

  const instanceService = new InstanceService(config);
  const visibleLines = Math.max(5, height - 6); // header + nav + padding

  const refresh = useCallback(async () => {
    const inst = instanceService.get(instanceName);
    if (!inst) { onBack(); return; }
    const openvpn = new OpenVPNService(inst);
    try {
      const logs = await openvpn.getLogs(200);
      const lines = logs.split("\n");
      setLogLines(lines);
      if (!userScrolled) {
        setScrollOffset(Math.max(0, lines.length - visibleLines));
      }
      setLoading(false);
    } catch {
      setLogLines(["No logs available"]);
      setLoading(false);
    }
  }, [instanceName, visibleLines]);

  useRefresh(refresh, 3000);

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "backspace" || key.name === "q") {
      onBack();
      return;
    }

    if (key.name === "up" || key.name === "k") {
      setUserScrolled(true);
      setScrollOffset((s) => Math.max(0, s - 1));
      return;
    }

    if (key.name === "down" || key.name === "j") {
      setUserScrolled(true);
      setScrollOffset((s) => Math.min(Math.max(0, logLines.length - visibleLines), s + 1));
      return;
    }

    if (key.name === "pageup") {
      setUserScrolled(true);
      setScrollOffset((s) => Math.max(0, s - visibleLines));
      return;
    }

    if (key.name === "pagedown") {
      setUserScrolled(true);
      setScrollOffset((s) => Math.min(Math.max(0, logLines.length - visibleLines), s + visibleLines));
      return;
    }

    if (key.name === "home" || key.name === "g") {
      setUserScrolled(true);
      setScrollOffset(0);
      return;
    }

    if (key.name === "end") {
      setUserScrolled(false);
      setScrollOffset(Math.max(0, logLines.length - visibleLines));
      return;
    }

    if (key.name === "r") {
      refresh();
      return;
    }
  });

  if (loading) {
    return (
      <box style={{ flexDirection: "column", padding: 1 }}>
        <Header title="Logs" breadcrumb={["Dashboard", instanceName]} />
        <Spinner label="Loading logs..." />
      </box>
    );
  }

  const visible = logLines.slice(scrollOffset, scrollOffset + visibleLines);
  const scrollPct = logLines.length > visibleLines
    ? Math.round((scrollOffset / (logLines.length - visibleLines)) * 100)
    : 100;

  return (
    <box style={{ flexDirection: "column", padding: 1, gap: 1 }}>
      <box style={{ height: 1, flexDirection: "row" }}>
        <Header title="Logs" breadcrumb={["Dashboard", instanceName]} />
        <text fg={colors.textDim}>  [{scrollPct}%]</text>
      </box>

      <box style={{ flexDirection: "column" }}>
        {visible.map((line, i) => (
          <text key={scrollOffset + i} fg={colors.textDim}>
            {line}
          </text>
        ))}
      </box>

      <NavBar
        shortcuts={[
          { key: "j/k", label: "Scroll" },
          { key: "PgUp/Dn", label: "Page" },
          { key: "r", label: "Refresh" },
          { key: "Esc", label: "Back" },
        ]}
      />
    </box>
  );
}
