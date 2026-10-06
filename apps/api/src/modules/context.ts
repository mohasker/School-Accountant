import type { Tx } from '../common/db';
import type { Identity } from '../core/identity';

/** A request inside a school: `schools/:school/:resource/:rid/:action`. */
export type ReadCtx = { s: Identity; school: string; rid?: string; action?: string; query: Record<string, any> };
export type WriteCtx = ReadCtx & { t: Tx; body: any; method: string };

export type Reader = (ctx: ReadCtx) => Promise<any>;
export type Writer = (ctx: WriteCtx) => Promise<any>;
