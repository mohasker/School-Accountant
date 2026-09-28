import { amount } from '../common/money';
import { esc, fmtDate, printDocument } from './layout';

export function tableReport(d: {
  title: string;
  ref: string;
  subtitle: string;
  heads: string[];
  rows: (string | number)[][];
  footer?: string;
}) {
  const body = `<h1>${esc(d.title)}</h1><p class="center">${esc(d.subtitle)}</p>
<table><tr>${d.heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${d.rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('')}</table>${d.footer ? `<p class="bold">${esc(d.footer)}</p>` : ''}`;
  return printDocument({ title: d.title, ref: d.ref, date: new Date(), body });
}

export { amount, fmtDate };
