import { useEffect, useState } from "react";
import { api } from "./api";

const names = new Map<string, string>();

/** A station's display name for its CRS code ("EDB" → "Edinburgh Waverley"); the code itself until the lookup returns. */
export function useStationName(crs: string): string {
  const [name, setName] = useState(names.get(crs) ?? crs);
  useEffect(() => {
    setName(names.get(crs) ?? crs);
    if (names.has(crs)) return;
    let cancelled = false;
    api
      .stations(crs)
      .then((found) => {
        const resolved = found.find((s) => s.crs === crs)?.name;
        if (!resolved) return;
        names.set(crs, resolved);
        if (!cancelled) setName(resolved);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [crs]);
  return name;
}
