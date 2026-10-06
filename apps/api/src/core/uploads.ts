import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fail } from '../common/validation';

/**
 * One check for every uploaded file (transaction attachments and the shared archive): the bytes must
 * match the declared type, and outside demo mode the configured virus scanner must accept them.
 */
export const UPLOAD_MIMES = ['application/pdf', 'image/png', 'image/jpeg'] as const;

const SIGNATURE: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 5).toString() === '%PDF-',
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': (b) => b[0] === 255 && b[1] === 216 && b[2] === 255,
};

/** Outside demo mode every upload must pass the configured virus scanner (ClamAV by default); a scanner failure refuses the file. */
export function scanUpload(data: Buffer) {
  if (process.env.DEMO_MODE === 'true') return 'DEMO_UNSCANNED';
  // A personal installation on a Windows PC has no ClamAV; the file type is still checked and the PC's own antivirus scans the disk.
  if (process.env.UPLOAD_SCANNER === 'none') return 'NOT_SCANNED';
  const dir = mkdtempSync(join(tmpdir(), 'sa-scan-'));
  try {
    const path = join(dir, 'upload');
    writeFileSync(path, data, { mode: 0o600 });
    const result = spawnSync(process.env.UPLOAD_SCANNER || 'clamscan', ['--no-summary', path], { timeout: 30000 });
    if (result.status !== 0) fail('تعذر فحص الملف أو اكتشاف ملف غير آمن');
    return 'CLEAN';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Refuses a file whose bytes do not match its declared type, then scans it; returns the scan status. */
export function checkUpload(mime: string, data: Buffer) {
  const matches = SIGNATURE[mime];
  if (!matches || !matches(data)) fail('محتوى الملف لا يطابق نوعه');
  return scanUpload(data);
}
