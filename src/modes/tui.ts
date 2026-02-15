import { loadConfig } from "../config.ts";
import { initDb } from "../db/index.ts";

export async function launchTUI(configPath?: string): Promise<void> {
  if (process.getuid && process.getuid() !== 0) {
    console.error("Error: TUI must be run as root (sudo ovpn-manager tui)");
    process.exit(1);
  }

  const config = await loadConfig(configPath);
  initDb(config.dbPath);

  // Dynamic import to avoid loading TUI deps when running as API server
  // Use string expression to prevent tsc from resolving the TUI module
  const tuiPath = "../tui/app.tsx";
  const { renderApp } = await import(/* @vite-ignore */ tuiPath);
  await renderApp(config);
}
