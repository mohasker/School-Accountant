/**
 * Backups of the local installation (Start-Madar.bat / npm run demo), where the database is an embedded
 * PostgreSQL kept in a data folder. The launcher registers the implementation; on a server (Docker) none
 * is registered and the nightly pg_dump of deploy/install.sh applies instead.
 */
export type BackupKind = 'daily' | 'manual' | 'purge' | 'restore';

export type BackupInfo = {
  name: string;
  kind: BackupKind;
  at: string;
  bytes: number;
};

export interface LocalStore {
  dataDir: string;
  backupDir: string;
  list(): BackupInfo[];
  /** A consistent snapshot of the open database; also copied to the external folder when one is set. */
  backup(kind: 'manual' | 'purge'): Promise<BackupInfo & { external?: string }>;
  /** Replaces the data with a listed backup after keeping the current data as a «before restore» copy. */
  restore(name: string, actor: string): Promise<void>;
  externalDir(): string;
  setExternalDir(dir: string): void;
  busy(): boolean;
}

let store: LocalStore | null = null;

export const setLocalStore = (s: LocalStore | null) => void (store = s);
export const localStore = () => store;
