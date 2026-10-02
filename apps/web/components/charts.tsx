'use client';
import React, { useState } from 'react';
import { currency } from '../lib/format';

/** Categorical slots (validated for colour-vision deficiency on the light surface); values stay in text ink. */
export const SERIES = ['#b8325a', '#2a78d6', '#1baf7a'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const monthName = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1] ?? m;

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Rounded "nice" axis maximum and 4 grid steps. */
function scale(max: number) {
  if (max <= 0) return { top: 1, ticks: [0] };
  const raw = max / 4,
    mag = 10 ** Math.floor(Math.log10(raw)),
    step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return { top: step * 4, ticks: [0, 1, 2, 3, 4].map((i) => i * step) };
}
const short = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k` : String(v));

/** Grouped vertical bars per month (one axis, same unit) with a hover card for the month. */
export function MonthlyBars({
  rows,
  series,
  label = (r) => monthName(r.month),
  aria = 'القيم الشهرية',
}: {
  rows: Record<string, any>[];
  series: { key: string; label: string; color?: string }[];
  label?: (r: Record<string, any>) => string;
  aria?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...rows.flatMap((r) => series.map((s) => Number(r[s.key] || 0))));
  const { top, ticks } = scale(max);
  const W = 720,
    H = 240,
    left = 44,
    bottom = 28,
    plotH = H - bottom - 10,
    groupW = (W - left - 8) / Math.max(rows.length, 1),
    barW = Math.max(4, Math.min(18, (groupW - 10) / series.length - 2));
  const y = (v: number) => 10 + plotH - (v / top) * plotH;
  return (
    <div className="chart">
      <Legend items={series.map((s, i) => ({ label: s.label, color: s.color ?? SERIES[i] }))} />
      <div className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={W - 4} y1={y(t)} y2={y(t)} className="grid" />
              <text x={left - 6} y={y(t) + 4} className="tick" textAnchor="end">
                {short(t)}
              </text>
            </g>
          ))}
          {rows.map((r, gi) => {
            const gx = left + gi * groupW;
            const inner = series.length * (barW + 2) - 2;
            return (
              <g key={gi} onMouseEnter={() => setHover(gi)}>
                <rect x={gx} y={0} width={groupW} height={H - bottom} className={hover === gi ? 'hit on' : 'hit'} />
                {series.map((s, si) => {
                  const v = Number(r[s.key] || 0),
                    x = gx + (groupW - inner) / 2 + si * (barW + 2),
                    h = (v / top) * plotH;
                  return v > 0 ? (
                    <path
                      key={s.key}
                      fill={s.color ?? SERIES[si]}
                      d={`M${x},${y(0)} V${y(0) - Math.max(h - 3, 0)} q0,-3 3,-3 h${barW - 6} q3,0 3,3 V${y(0)} Z`}
                    />
                  ) : null;
                })}
                <text x={gx + groupW / 2} y={H - 8} className="tick" textAnchor="middle">
                  {label(r)}
                </text>
              </g>
            );
          })}
          <line x1={left} x2={W - 4} y1={y(0)} y2={y(0)} className="axis" />
        </svg>
        {hover !== null && rows[hover] && (
          <div className="chart-tip" style={{ left: `${((left + (hover + 0.5) * groupW) / W) * 100}%` }}>
            <b>{label(rows[hover])}</b>
            {series.map((s, i) => (
              <span key={s.key}>
                <i style={{ background: s.color ?? SERIES[i] }} />
                {s.label}: {currency(rows[hover][s.key])}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Budget lines as one horizontal bar each: spent, committed and the remaining balance. */
export function BudgetBars({ lines, compact }: { lines: Record<string, any>[]; compact?: boolean }) {
  const [hover, setHover] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const shown = compact && !all ? lines.slice(0, 8) : lines;
  const parts = [
    { key: 'spent', label: 'المصروف', color: SERIES[0] },
    { key: 'committed', label: 'الارتباطات (تكليفات قائمة)', color: SERIES[1] },
    { key: 'available', label: 'الرصيد المتاح', color: 'var(--track)' },
  ];
  return (
    <div className="chart">
      <Legend items={parts.map((p) => ({ label: p.label, color: p.color }))} />
      <div className={compact ? 'hbars compact' : 'hbars'}>
        {shown.map((l) => {
          const total = Math.max(Number(l.approved), Number(l.spent) + Number(l.committed), 1);
          return (
            <div className="hbar" key={l.id} onMouseEnter={() => setHover(l.id)} onMouseLeave={() => setHover(null)}>
              <div className="hbar-label">
                <span>
                  {l.name} <small className="mono">{l.code}</small>
                </span>
                <b>{currency(l.available)}</b>
              </div>
              <div className="hbar-track">
                {parts.map((p) =>
                  Number(l[p.key]) > 0 ? (
                    <span key={p.key} style={{ width: `${(100 * Number(l[p.key])) / total}%`, background: p.color }} />
                  ) : null,
                )}
              </div>
              {hover === l.id && (
                <small className="hbar-tip">
                  الاعتماد {currency(l.approved)} · المصروف {currency(l.spent)} · الارتباطات {currency(l.committed)} · المتاح{' '}
                  {currency(l.available)} ر.ق
                </small>
              )}
            </div>
          );
        })}
      </div>
      {compact && lines.length > 8 && (
        <button type="button" className="link" onClick={() => setAll((a) => !a)}>
          {all ? 'عرض أقل ▴' : `عرض كل البنود (${lines.length}) ▾`}
        </button>
      )}
    </div>
  );
}

/** Budget execution as one headline figure with a thin progress arc (spent, then commitments). */
export function ExecutionGauge({
  approved,
  spent,
  committed,
  elapsed,
}: {
  approved: number;
  spent: number;
  committed: number;
  elapsed: number;
}) {
  const R = 64,
    C = Math.PI * R,
    total = approved || 1;
  const p1 = Math.min(1, spent / total),
    p2 = Math.min(1 - p1, committed / total);
  const arc = 'M16,84 A64,64 0 0 1 144,84';
  return (
    <div className="gauge">
      <svg viewBox="0 0 160 96" role="img" aria-label={`نسبة التنفيذ ${Math.round(p1 * 100)}%`}>
        <path d={arc} className="gauge-track" pathLength={C} />
        {p2 > 0 && (
          <path
            d={arc}
            stroke={SERIES[1]}
            className="gauge-bar"
            pathLength={C}
            strokeDasharray={`0 ${p1 * C + 1} ${Math.max(p2 * C - 1, 0)} ${C}`}
          />
        )}
        {p1 > 0 && <path d={arc} stroke={SERIES[0]} className="gauge-bar" pathLength={C} strokeDasharray={`${p1 * C} ${C}`} />}
        <line
          x1={80 - 58 * Math.cos(Math.PI * elapsed)}
          y1={84 - 58 * Math.sin(Math.PI * elapsed)}
          x2={80 - 76 * Math.cos(Math.PI * elapsed)}
          y2={84 - 76 * Math.sin(Math.PI * elapsed)}
          className="gauge-mark"
        />
        <text x="80" y="72" textAnchor="middle" className="gauge-value">
          {Math.round(p1 * 1000) / 10}%
        </text>
        <text x="80" y="93" textAnchor="middle" className="gauge-label">
          نسبة الصرف من المعتمد
        </text>
      </svg>
      <Legend
        items={[
          { label: 'المصروف', color: SERIES[0] },
          { label: 'الارتباطات', color: SERIES[1] },
          { label: `المنقضي من العام ${Math.round(elapsed * 100)}%`, color: 'var(--ink)' },
        ]}
      />
    </div>
  );
}

/** Budget groups as labelled horizontal bars (approved, spent, commitments), readable at any width. */
export function GroupBars({ groups }: { groups: Record<string, any>[] }) {
  const parts = [
    { key: 'approved', label: 'المعتمد', color: SERIES[2] },
    { key: 'spent', label: 'المصروف', color: SERIES[0] },
    { key: 'committed', label: 'الارتباطات', color: SERIES[1] },
  ];
  const max = Math.max(1, ...groups.map((g) => Number(g.approved)), ...groups.map((g) => Number(g.spent) + Number(g.committed)));
  return (
    <div className="chart">
      <Legend items={parts} />
      <div className="group-bars">
        {groups.map((g) => (
          <div key={g.key} className="group-bar">
            <div className="hbar-label">
              <span>{g.name}</span>
              <small>{Math.round((1000 * Number(g.spent)) / (Number(g.approved) || 1)) / 10}% مصروف</small>
            </div>
            {parts.map((p) => (
              <div className="gb-row" key={p.key} title={`${p.label}: ${currency(g[p.key])} ر.ق`}>
                <span className="gb-track">
                  <span style={{ width: `${(100 * Number(g[p.key])) / max}%`, background: p.color }} />
                </span>
                <small>{currency(g[p.key])}</small>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
