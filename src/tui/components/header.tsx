import { colors } from "../theme.ts";

interface HeaderProps {
  title: string;
  breadcrumb?: string[];
}

export function Header({ title, breadcrumb }: HeaderProps) {
  const crumbText = breadcrumb?.length ? breadcrumb.join(" > ") + " > " : "";

  return (
    <box style={{ height: 1 }}>
      <text fg={colors.primary}>
        <strong>{crumbText}{title}</strong>
      </text>
    </box>
  );
}
