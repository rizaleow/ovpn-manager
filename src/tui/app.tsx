import { createCliRenderer } from "@opentui/core";
import { createRoot, useRenderer } from "@opentui/react";
import { useNavigation, type Screen } from "./hooks/use-navigation.ts";
import { Dashboard } from "./screens/dashboard.tsx";
import { SetupWizard } from "./screens/setup-wizard.tsx";
import { InstanceScreen } from "./screens/instance.tsx";
import { ClientsScreen } from "./screens/clients.tsx";
import { LogsScreen } from "./screens/logs.tsx";
import { useCallback } from "react";
import type { AppConfig } from "../types/index.ts";

interface AppProps {
  config: AppConfig;
}

function App({ config }: AppProps) {
  const { current, push, pop, reset } = useNavigation();
  const renderer = useRenderer();

  const handleNavigate = useCallback((screen: Screen) => {
    if (screen.name === "dashboard") {
      reset();
    } else {
      push(screen);
    }
  }, [push, reset]);

  const handleQuit = useCallback(() => {
    renderer.destroy();
  }, [renderer]);

  switch (current.name) {
    case "dashboard":
      return <Dashboard config={config} onNavigate={handleNavigate} onQuit={handleQuit} />;

    case "setup-wizard":
      return <SetupWizard config={config} onNavigate={handleNavigate} onBack={pop} />;

    case "instance":
      return (
        <InstanceScreen
          config={config}
          instanceName={current.instanceName}
          onNavigate={handleNavigate}
          onBack={pop}
        />
      );

    case "clients":
      return (
        <ClientsScreen
          config={config}
          instanceName={current.instanceName}
          onBack={pop}
        />
      );

    case "logs":
      return (
        <LogsScreen
          config={config}
          instanceName={current.instanceName}
          onBack={pop}
        />
      );

    default:
      return <text>Unknown screen</text>;
  }
}

export async function renderApp(config: AppConfig): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  createRoot(renderer).render(<App config={config} />);
}
