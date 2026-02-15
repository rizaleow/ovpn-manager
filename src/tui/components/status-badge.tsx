import { statusColors, colors } from "../theme.ts";

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const color = statusColors[status] ?? colors.muted;
  const icon = status === "active" ? "●" : status === "error" ? "✗" : "○";

  return (
    <text fg={color}>
      {icon} {status}
    </text>
  );
}
