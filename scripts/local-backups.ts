import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import type { BackupInfo, BackupKind, LocalStore } from '../apps/api/src/core/local-store';

/**
 * Copies of the local data folder: one per day taken before the database opens (folder), copies on
 * request or before a purge (a consistent snapshot of the open database, .tar.gz), and the data kept
 * aside before a restore (folder). Each kind keeps its newest copies only.
 */
const NAME = /^moesas-(\d{4}-\d{2}-\d{2})(?:-(\d{6}))?(?:-(manual|purge|restore))?(\.tar\.gz)?$/;
const KEEP: Record<BackupKind, number> = { daily: 14, manual: 10, purge: 10, restore: 5 };

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const today = () => stamp().slice(0, 10);

function size(path: string): number {
  const st = statSync(path);
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((n, f) => n + size(join(path, f)), 0);
}

export function listBackups(root: string): BackupInfo[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((name) => {
      const m = NAME.exec(name);
      if (!m) return null;
      const path = join(root, name);
      return { name, kind: (m[3] ?? 'daily') as BackupKind, at: statSync(path).mtime.toISOString(), bytes: size(path) };
    })
    .filter((b): b is BackupInfo => !!b)
    .sort((a, b) => b.at.localeCompare(a.at));
}

function prune(root: string) {
  const all = listBackups(root);
  for (const kind of Object.keys(KEEP) as BackupKind[])
    for (const b of all.filter((x) => x.kind === kind).slice(KEEP[kind])) rmSync(join(root, b.name), { recursive: true, force: true });
}

const settingsFile = (root: string) => join(dirname(root), basename(root) + '-settings.json');
function readExternal(root: string): string {
  try {
    return String(JSON.parse(readFileSync(settingsFile(root), 'utf8')).externalDir ?? '');
  } catch {
    return '';
  }
}

/** Copies one backup to the external folder too (flash drive, synced OneDrive folder); a failure is reported, not fatal. */
function copyExternal(root: string, name: string): string | undefined {
  const dir = readExternal(root);
  if (!dir) return undefined;
  try {
    const target = join(dir, 'MOESAS-backups');
    mkdirSync(target, { recursive: true });
    cpSync(join(root, name), join(target, name), { recursive: true });
    prune(target);
    return join(target, name);
  } catch (e: any) {
    console.error('External backup copy failed:', e.message);
    return 'تعذّر النسخ إلى المجلد الخارجي: ' + e.message;
  }
}

/** One copy of the data folder per day, taken before the database opens. */
export function dailyBackup(dataDir: string, root: string) {
  if (!existsSync(dataDir) || !readdirSync(dataDir).length) return;
  const name = `moesas-${today()}`;
  if (existsSync(join(root, name))) return;
  mkdirSync(root, { recursive: true });
  cpSync(dataDir, join(root, name), { recursive: true });
  copyExternal(root, name);
  prune(root);
  console.log('Daily backup: ' + join(root, name));
}

/**
 * The store the API uses. `restart` closes the API and the database, runs the given step while nothing
 * is open, then opens everything again on the same data folder.
 */
export function createStore(o: {
  dataDir: string;
  root: string;
  engine: () => PGlite;
  restart: (whileClosed: () => Promise<void>) => Promise<void>;
  restored: (info: { from: string; kept: string; actor: string }) => Promise<void>;
}): LocalStore {
  let running = false;
  const guard = async <T>(fn: () => Promise<T>) => {
    running = true;
    try {
      return await fn();
    } finally {
      running = false;
    }
  };
  return {
    dataDir: resolve(o.dataDir),
    backupDir: resolve(o.root),
    busy: () => running,
    list: () => listBackups(o.root),
    externalDir: () => readExternal(o.root),
    setExternalDir(dir) {
      mkdirSync(dirname(settingsFile(o.root)), { recursive: true });
      writeFileSync(settingsFile(o.root), JSON.stringify({ externalDir: dir }, null, 2));
    },
    backup: (kind) =>
      guard(async () => {
        mkdirSync(o.root, { recursive: true });
        const name = `moesas-${stamp()}-${kind}.tar.gz`;
        const blob = await o.engine().dumpDataDir('gzip');
        writeFileSync(join(o.root, name), Buffer.from(await blob.arrayBuffer()));
        const external = copyExternal(o.root, name);
        prune(o.root);
        const info = listBackups(o.root).find((b) => b.name === name)!;
        return { ...info, ...(external ? { external } : {}) };
      }),
    async restore(name, actor) {
      const source = join(o.root, name);
      if (!NAME.test(name) || !existsSync(source)) throw Error('backup not found');
      running = true;
      // Answer the request first; the switch happens a moment later.
      setTimeout(() => {
        const kept = `moesas-${stamp()}-restore`;
        o.restart(async () => {
          renameSync(o.dataDir, join(o.root, kept));
          try {
            if (statSync(source).isDirectory()) cpSync(source, o.dataDir, { recursive: true });
            else {
              const { PGlite } = await import('@electric-sql/pglite');
              const e = await PGlite.create(o.dataDir, { loadDataDir: new Blob([readFileSync(source)]) });
              await e.close();
            }
          } catch (e) {
            // The copy could not be opened: the current data goes back in place untouched.
            rmSync(o.dataDir, { recursive: true, force: true });
            renameSync(join(o.root, kept), o.dataDir);
            throw e;
          }
          prune(o.root);
        })
          .then(() => o.restored({ from: name, kept, actor }))
          .then(() => console.log(`Restored ${name}; the previous data is kept in ${kept}`))
          .catch((e) => console.error('Restore failed:', e))
          .finally(() => (running = false));
      }, 300);
    },
  };
}
