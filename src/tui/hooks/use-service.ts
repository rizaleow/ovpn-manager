import { useState, useCallback } from "react";

interface ServiceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useService<T>() {
  const [state, setState] = useState<ServiceState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const run = useCallback(async (fn: () => Promise<T>) => {
    setState({ data: null, loading: true, error: null });
    try {
      const data = await fn();
      setState({ data, loading: false, error: null });
      return data;
    } catch (err) {
      setState({ data: null, loading: false, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }, []);

  return { ...state, run };
}
