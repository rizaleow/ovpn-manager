import { parseArgs, printHelp, printVersion, isTTY } from "./cli.ts";
import { configExists } from "./config.ts";

const args = parseArgs();

if (args.showHelp) {
  printHelp();
  process.exit(0);
}

if (args.showVersion) {
  printVersion();
  process.exit(0);
}

let command = args.command;

// Auto-detect mode
if (command === "auto") {
  if (!(await configExists(args.configPath)) && isTTY()) {
    command = "setup";
  } else if (isTTY()) {
    command = "tui";
  } else {
    command = "serve";
  }
}

switch (command) {
  case "serve": {
    const { startServer } = await import("./modes/serve.ts");
    await startServer(args.configPath);
    break;
  }

  case "setup": {
    if (!isTTY()) {
      console.error("Error: Setup requires an interactive terminal (TTY)");
      process.exit(1);
    }
    const { runSetup } = await import("./modes/setup.ts");
    await runSetup(args.configPath);
    break;
  }

  case "tui": {
    if (!isTTY()) {
      console.error("Error: TUI requires an interactive terminal (TTY)");
      process.exit(1);
    }
    const { launchTUI } = await import("./modes/tui.ts");
    await launchTUI(args.configPath);
    break;
  }

  case "upgrade": {
    const { runUpgrade } = await import("./services/updater.ts");
    await runUpgrade();
    break;
  }

  case "uninstall": {
    const { runUninstall } = await import("./services/system-setup.ts");
    await runUninstall();
    break;
  }
}
