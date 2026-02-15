export const colors = {
  primary: "#6C9EFF",
  success: "#22C55E",
  warning: "#F59E0B",
  error: "#EF4444",
  muted: "#666666",
  text: "#E0E0E0",
  textDim: "#888888",
  bg: "#1A1A2E",
  bgAlt: "#16213E",
  border: "#333355",
  accent: "#0F3460",
} as const;

export const statusColors: Record<string, string> = {
  active: colors.success,
  inactive: colors.muted,
  setup: colors.warning,
  error: colors.error,
};
