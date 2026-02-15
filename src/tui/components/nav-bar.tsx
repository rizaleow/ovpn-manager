import { colors } from "../theme.ts";

interface Shortcut {
  key: string;
  label: string;
}

interface NavBarProps {
  shortcuts: Shortcut[];
}

export function NavBar({ shortcuts }: NavBarProps) {
  const parts = shortcuts.map((s) => `[${s.key}] ${s.label}`).join("  ");

  return (
    <box style={{ height: 1 }}>
      <text fg={colors.textDim}>{parts}</text>
    </box>
  );
}
