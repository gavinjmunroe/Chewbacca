import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api.js";

export function useApi(path) {
  const [state, setState] = useState({
    loading: Boolean(path),
    data: null,
    error: null,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let active = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    apiFetch(path)
      .then((data) => active && setState({ loading: false, data, error: null }))
      .catch(
        (err) =>
          active &&
          setState({ loading: false, data: null, error: err.message }),
      );
    return () => {
      active = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
