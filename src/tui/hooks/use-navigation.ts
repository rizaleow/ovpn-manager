import { useState, useCallback } from "react";

export type Screen =
  | { name: "dashboard" }
  | { name: "setup-wizard"; instanceName?: string }
  | { name: "instance"; instanceName: string }
  | { name: "clients"; instanceName: string }
  | { name: "logs"; instanceName: string };

export function useNavigation() {
  const [stack, setStack] = useState<Screen[]>([{ name: "dashboard" }]);

  const current = stack[stack.length - 1]!;

  const push = useCallback((screen: Screen) => {
    setStack((s) => [...s, screen]);
  }, []);

  const pop = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const reset = useCallback(() => {
    setStack([{ name: "dashboard" }]);
  }, []);

  return { current, push, pop, reset, depth: stack.length };
}
