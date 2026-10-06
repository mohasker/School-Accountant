'use client';
import { useEffect, useState } from 'react';
import { useWorkspace } from './context';

/** Loads data for a view and reloads it after every saved change (workspace version). */
export function useLoad<T>(load: () => Promise<T> | null, deps: unknown[] = []) {
  const w = useWorkspace();
  const [data, setData] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const p = load();
    if (p) p.then((d) => live && setData(d)).catch((e) => live && w.fail(e));
    return () => {
      live = false;
    };
  }, [w.school, w.year, w.version, tick, ...deps]);
  return [data, () => setTick((n) => n + 1)] as const;
}
