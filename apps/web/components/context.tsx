'use client';
import { createContext, useContext } from 'react';
import type { Row } from '../lib/api';
import type { Dialog } from './FormDialog';

export type View =
  | 'dashboard'
  | 'cases'
  | 'case'
  | 'suppliers'
  | 'budget'
  | 'imprests'
  | 'reports'
  | 'registry'
  | 'holidays'
  | 'policy'
  | 'settings'
  | 'audit';

export type Workspace = {
  me: Row;
  school: string;
  year: string;
  setup: Row;
  can: (...roles: string[]) => boolean;
  /** Raw API call: path under /api/ */
  api: (path: string, method?: string, body?: unknown) => Promise<any>;
  /** Path inside the selected school: schools/:school/… */
  root: (path: string) => string;
  open: (dialog: Dialog) => void;
  /** Runs a mutation with busy state, success notice and a data refresh. */
  task: (fn: () => Promise<unknown>, notice?: string) => Promise<void>;
  /** Fetches `{ html }` from the path and opens it for printing. */
  print: (path: string) => Promise<void>;
  printHtml: (html: string) => void;
  fail: (e: unknown) => void;
  go: (view: View, caseId?: string) => void;
  /** Increments after every successful change so views reload their data. */
  version: number;
  busy: boolean;
};

export const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('Workspace context missing');
  return ctx;
}
