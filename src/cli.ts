const VERSION = "0.2.0";

interface ParsedArgs {
  command: "serve" | "setup" | "tui" | "upgrade" | "uninstall" | "auto";
  configPath?: string;
  showHelp: boolean;
  showVersion: boolean;
}

export function parseArgs(argv: string[] = process.argv): ParsedArgs {
  const args = argv.slice(2); // skip bun/node + script path
  const result: ParsedArgs = {
    command: "auto",
    showHelp: false,
    showVersion: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;

    switch (arg) {
      case "serve":
      case "setup":
      case "tui":
      case "upgrade":
      case "uninstall":
        result.command = arg;
        break;

      case "--config":
      case "-c":
        i++;
        result.configPath = args[i];
        if (!result.configPath) {
          console.error("Error: --config requires a path argument");
          process.exit(1);
        }
        break;

      case "--help":
      case "-h":
        result.showHelp = true;
        break;

      case "--version":
      case "-v":
        result.showVersion = true;
        break;

      default:
        // Ignore unknown flags silently (e.g. --_cleanup from install.sh)
        break;
    }
    i++;
  }

  return result;
}

export function printHelp(): void {
  console.log(`
ovpn-manager v${VERSION} — OpenVPN server manager

Usage:
  ovpn-manager                  Auto-detect mode (setup/tui/serve)
  ovpn-manager serve            Start REST API server
  ovpn-manager setup            Run first-time setup wizard
  ovpn-manager tui              Launch interactive TUI
  ovpn-manager upgrade          Self-update to latest version
  ovpn-manager uninstall        Remove binary, service, and optionally data

Options:
  --config, -c <path>   Config file path
  --help, -h            Show this help
  --version, -v         Show version

Auto-detection:
  1. No config exists + TTY  → setup wizard
  2. TTY                     → TUI dashboard
  3. Non-TTY                 → API server
`.trim());
}

export function printVersion(): void {
  console.log(`ovpn-manager v${VERSION}`);
}

export function isTTY(): boolean {
  return Boolean(process.stdin.isTTY);
}

export { VERSION };
