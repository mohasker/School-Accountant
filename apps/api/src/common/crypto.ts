import { createHash } from 'node:crypto';

export const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
