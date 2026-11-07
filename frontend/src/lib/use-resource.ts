import { useEffect, useRef, useState } from "react";
export function useResource<T>(loader: () => Promise<T>, key = "") {
  const current = useRef(loader); current.current = loader;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  useEffect(() => {
    let active = true;
    setState({ data: null, loading: true, error: null });
    current.current().then((data) => { if (active) setState({ data, loading: false, error: null }); }).catch((error: unknown) => { if (active) setState({ data: null, loading: false, error: error instanceof Error ? error.message : "Could not load data. Try again." }); });
    return () => { active = false; };
  }, [key, revision]);
  useEffect(() => { const refresh = () => setRevision((n) => n + 1); window.addEventListener("reuse-items-changed", refresh); return () => window.removeEventListener("reuse-items-changed", refresh); }, []);
  return { ...state, reload: () => setRevision((n) => n + 1) };
}
export const itemsChanged = () => window.dispatchEvent(new Event("reuse-items-changed"));
