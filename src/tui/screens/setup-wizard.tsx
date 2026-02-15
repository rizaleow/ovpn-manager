import { useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { Header } from "../components/header.tsx";
import { NavBar } from "../components/nav-bar.tsx";
import { Spinner } from "../components/spinner.tsx";
import { colors } from "../theme.ts";
import type { AppConfig } from "../../types/index.ts";
import { InstanceService } from "../../services/instance.ts";
import { PKIService } from "../../services/pki.ts";
import { OpenVPNService } from "../../services/openvpn.ts";
import { NetworkService } from "../../services/network.ts";
import { getDb } from "../../db/index.ts";
import type { Screen } from "../hooks/use-navigation.ts";

interface SetupWizardProps {
  config: AppConfig;
  onNavigate: (screen: Screen) => void;
  onBack: () => void;
}

type Step = "name" | "hostname" | "port" | "subnet" | "dns" | "confirm" | "running" | "done" | "error";

interface FormData {
  name: string;
  displayName: string;
  hostname: string;
  port: string;
  protocol: "udp" | "tcp";
  subnet: string;
  subnetMask: string;
  dns: string;
  cipher: string;
}

const STEPS: Step[] = ["name", "hostname", "port", "subnet", "dns", "confirm"];

export function SetupWizard({ config, onNavigate, onBack }: SetupWizardProps) {
  const [step, setStep] = useState<Step>("name");
  const [stepIndex, setStepIndex] = useState(0);
  const [focused, setFocused] = useState<string>("name");
  const [runStatus, setRunStatus] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormData>({
    name: "",
    displayName: "",
    hostname: "",
    port: "1194",
    protocol: "udp",
    subnet: "10.8.0.0",
    subnetMask: "255.255.255.0",
    dns: "1.1.1.1, 1.0.0.1",
    cipher: "AES-256-GCM",
  });

  const updateField = useCallback((field: keyof FormData, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
  }, []);

  const nextStep = useCallback(() => {
    const nextIdx = stepIndex + 1;
    if (nextIdx < STEPS.length) {
      setStepIndex(nextIdx);
      setStep(STEPS[nextIdx]!);
    }
  }, [stepIndex]);

  const prevStep = useCallback(() => {
    if (stepIndex > 0) {
      const prevIdx = stepIndex - 1;
      setStepIndex(prevIdx);
      setStep(STEPS[prevIdx]!);
    } else {
      onBack();
    }
  }, [stepIndex, onBack]);

  const runSetup = useCallback(async () => {
    setStep("running");
    const instanceService = new InstanceService(config);

    try {
      setRunStatus("Creating instance...");
      const instance = await instanceService.create(form.name, form.displayName || undefined);

      const db = getDb();
      const pki = new PKIService(instance);
      const openvpn = new OpenVPNService(instance);
      const network = new NetworkService(instance);

      setRunStatus("Initializing PKI (this may take a while)...");
      await pki.initPKI();
      await pki.buildCA();
      await pki.genServerCert();
      await pki.genDH();
      await pki.genTLSAuth();
      await pki.genCRL();

      setRunStatus("Configuring server...");
      const dnsList = form.dns.split(",").map((d) => d.trim()).filter(Boolean);
      db.run(
        `UPDATE server_config SET
          hostname = ?, protocol = ?, port = ?, dev_type = 'tun',
          subnet = ?, subnet_mask = ?, dns = ?, cipher = ?,
          pki_initialized = 1, updated_at = datetime('now')
        WHERE instance_id = ?`,
        [
          form.hostname,
          form.protocol,
          parseInt(form.port, 10),
          form.subnet,
          form.subnetMask,
          JSON.stringify(dnsList),
          form.cipher,
          instance.id,
        ],
      );
      await openvpn.writeServerConfig();

      setRunStatus("Setting up networking...");
      await network.enableForwarding();
      await network.setupNAT(form.subnet, form.subnetMask);
      await network.persistIptables();

      setRunStatus("Starting OpenVPN...");
      await openvpn.enable();
      await openvpn.start();

      instanceService.updateStatus(instance.name, "active");
      db.run("UPDATE setup_state SET completed = 1, step = 'running', completed_at = datetime('now') WHERE instance_id = ?", [instance.id]);

      setStep("done");
    } catch (err: any) {
      setError(err.message);
      setStep("error");
    }
  }, [config, form]);

  useKeyboard((key) => {
    if (step === "done") {
      if (key.name === "return") {
        onNavigate({ name: "instance", instanceName: form.name });
      }
      if (key.name === "escape") {
        onNavigate({ name: "dashboard" });
      }
      return;
    }

    if (step === "error") {
      if (key.name === "escape" || key.name === "return") {
        onBack();
      }
      return;
    }

    if (step === "running") return;

    if (key.name === "escape") {
      prevStep();
      return;
    }

    if (step === "confirm" && key.name === "return") {
      runSetup();
      return;
    }

    if (key.name === "tab") {
      if (step === "port") {
        updateField("protocol", form.protocol === "udp" ? "tcp" : "udp");
      }
    }
  });

  const progress = `Step ${stepIndex + 1}/${STEPS.length}`;

  if (step === "running") {
    return (
      <box style={{ flexDirection: "column", padding: 1, gap: 1 }}>
        <Header title="Setup Wizard" breadcrumb={["New Instance"]} />
        <Spinner label={runStatus} />
      </box>
    );
  }

  if (step === "done") {
    return (
      <box style={{ flexDirection: "column", padding: 1, gap: 1 }}>
        <Header title="Setup Complete" breadcrumb={["New Instance"]} />
        <text fg={colors.success}>Instance "{form.name}" created and running!</text>
        <text fg={colors.textDim}>Press Enter to view instance, Esc to go back</text>
      </box>
    );
  }

  if (step === "error") {
    return (
      <box style={{ flexDirection: "column", padding: 1, gap: 1 }}>
        <Header title="Setup Failed" breadcrumb={["New Instance"]} />
        <text fg={colors.error}>Error: {error}</text>
        <text fg={colors.textDim}>Press Esc to go back</text>
      </box>
    );
  }

  return (
    <box style={{ flexDirection: "column", padding: 1, gap: 1 }}>
      <Header title="Setup Wizard" breadcrumb={["New Instance"]} />
      <text fg={colors.textDim}>{progress}</text>

      {step === "name" && (
        <box style={{ flexDirection: "column", gap: 1 }}>
          <text fg={colors.text}>Instance name (alphanumeric, dashes):</text>
          <box style={{ border: true, height: 3, borderColor: colors.primary }}>
            <input
              placeholder="e.g. default, office, guest"
              onInput={(v: string) => updateField("name", v)}
              onSubmit={nextStep}
              focused
            />
          </box>
          <text fg={colors.textDim}>Display name (optional):</text>
          <box style={{ border: true, height: 3, borderColor: colors.border }}>
            <input
              placeholder="e.g. Office VPN"
              onInput={(v: string) => updateField("displayName", v)}
              onSubmit={nextStep}
              focused={false}
            />
          </box>
        </box>
      )}

      {step === "hostname" && (
        <box style={{ flexDirection: "column", gap: 1 }}>
          <text fg={colors.text}>Server hostname or IP (clients connect to this):</text>
          <box style={{ border: true, height: 3, borderColor: colors.primary }}>
            <input
              placeholder="e.g. vpn.example.com or 1.2.3.4"
              onInput={(v: string) => updateField("hostname", v)}
              onSubmit={nextStep}
              focused
            />
          </box>
        </box>
      )}

      {step === "port" && (
        <box style={{ flexDirection: "column", gap: 1 }}>
          <text fg={colors.text}>Port:</text>
          <box style={{ border: true, height: 3, borderColor: colors.primary }}>
            <input
              placeholder="1194"
              onInput={(v: string) => updateField("port", v)}
              onSubmit={nextStep}
              focused
            />
          </box>
          <text fg={colors.text}>
            Protocol: <text fg={colors.primary}>{form.protocol}</text> (Tab to toggle)
          </text>
        </box>
      )}

      {step === "subnet" && (
        <box style={{ flexDirection: "column", gap: 1 }}>
          <text fg={colors.text}>VPN subnet:</text>
          <box style={{ border: true, height: 3, borderColor: colors.primary }}>
            <input
              placeholder="10.8.0.0"
              onInput={(v: string) => updateField("subnet", v)}
              onSubmit={nextStep}
              focused
            />
          </box>
          <text fg={colors.text}>Subnet mask:</text>
          <box style={{ border: true, height: 3, borderColor: colors.border }}>
            <input
              placeholder="255.255.255.0"
              onInput={(v: string) => updateField("subnetMask", v)}
              onSubmit={nextStep}
              focused={false}
            />
          </box>
        </box>
      )}

      {step === "dns" && (
        <box style={{ flexDirection: "column", gap: 1 }}>
          <text fg={colors.text}>DNS servers (comma-separated):</text>
          <box style={{ border: true, height: 3, borderColor: colors.primary }}>
            <input
              placeholder="1.1.1.1, 1.0.0.1"
              onInput={(v: string) => updateField("dns", v)}
              onSubmit={nextStep}
              focused
            />
          </box>
        </box>
      )}

      {step === "confirm" && (
        <box style={{ flexDirection: "column", gap: 1 }}>
          <text fg={colors.text}>Review configuration:</text>
          <text fg={colors.textDim}>  Name:     {form.name}</text>
          <text fg={colors.textDim}>  Hostname: {form.hostname}</text>
          <text fg={colors.textDim}>  Port:     {form.port}/{form.protocol}</text>
          <text fg={colors.textDim}>  Subnet:   {form.subnet}/{form.subnetMask}</text>
          <text fg={colors.textDim}>  DNS:      {form.dns}</text>
          <text fg={colors.textDim}>  Cipher:   {form.cipher}</text>
          <text />
          <text fg={colors.success}>Press Enter to start setup, Esc to go back</text>
        </box>
      )}

      <NavBar
        shortcuts={[
          { key: "Enter", label: "Next" },
          { key: "Esc", label: "Back" },
          ...(step === "port" ? [{ key: "Tab", label: "Toggle protocol" }] : []),
        ]}
      />
    </box>
  );
}
