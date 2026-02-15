import { exec } from "../utils/shell.ts";
import { VERSION } from "../cli.ts";

const REPO = "rizaleow/ovpn-manager";
const BINARY_PATH = "/usr/local/bin/ovpn-manager";

interface Release {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
}

async function getLatestRelease(): Promise<Release> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (!res.ok) {
    throw new Error(`Failed to check for updates: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<Release>;
}

function detectArch(): string {
  const arch = process.arch;
  switch (arch) {
    case "x64": return "x64";
    case "arm64": return "arm64";
    default: throw new Error(`Unsupported architecture: ${arch}`);
  }
}

export async function checkForUpdate(): Promise<{ current: string; latest: string; hasUpdate: boolean }> {
  const release = await getLatestRelease();
  const latest = release.tag_name.replace(/^v/, "");
  const current = VERSION;
  return { current, latest, hasUpdate: latest !== current };
}

export async function runUpgrade(targetVersion?: string): Promise<void> {
  console.log("OpenVPN Manager — Self-Update\n");

  // Check root
  if (process.getuid && process.getuid() !== 0) {
    console.error("Error: Upgrade must be run as root (sudo ovpn-manager upgrade)");
    process.exit(1);
  }

  const arch = detectArch();

  let release: Release;
  if (targetVersion) {
    const tag = targetVersion.startsWith("v") ? targetVersion : `v${targetVersion}`;
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`);
    if (!res.ok) throw new Error(`Version ${tag} not found`);
    release = await res.json() as Release;
  } else {
    release = await getLatestRelease();
  }

  const version = release.tag_name;
  console.log(`  Current: v${VERSION}`);
  console.log(`  Target:  ${version}\n`);

  if (version.replace(/^v/, "") === VERSION) {
    console.log("Already up to date.");
    return;
  }

  const assetName = `ovpn-manager-linux-${arch}`;
  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) {
    throw new Error(`No binary found for linux-${arch} in release ${version}`);
  }

  // Download to temp
  console.log("  Downloading...");
  const res = await fetch(asset.browser_download_url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const tmpPath = `/tmp/ovpn-manager-${version}`;
  await Bun.write(tmpPath, res);
  const { chmodSync, copyFileSync, unlinkSync } = await import("node:fs");
  chmodSync(tmpPath, 0o755);

  // Back up current binary
  const backupPath = `${BINARY_PATH}.bak`;
  try {
    copyFileSync(BINARY_PATH, backupPath);
  } catch {}

  // Replace
  copyFileSync(tmpPath, BINARY_PATH);
  unlinkSync(tmpPath);
  console.log("  Binary updated.");

  // Restart service
  try {
    await exec(["systemctl", "restart", "ovpn-manager"]);
    try { unlinkSync(backupPath); } catch {}
    console.log("  Service restarted.\n");
    console.log(`Upgraded to ${version}!`);
  } catch {
    // Rollback
    console.log("  Service failed to start — rolling back...");
    try {
      copyFileSync(backupPath, BINARY_PATH);
      await exec(["systemctl", "restart", "ovpn-manager"]);
    } catch {}
    console.error("Upgrade failed. Previous version restored.");
    process.exit(1);
  }
}
