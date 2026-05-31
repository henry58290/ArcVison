import { useState, useMemo } from 'react';
import { cumulativePnl } from './mockBets';
import './profile.css';

const RANGES = [
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: 'all', label: 'All' },
];

function signedUsd(v) {
  const sign = v < 0 ? '−' : '+';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * PnlChart — inline-SVG cumulative realized-P&L area chart.
 *
 * Self-contained: takes the `bets` array and derives the series via
 * cumulativePnl(bets, range) for the active 7D/30D/All toggle. No network,
 * no chart library. `since` is an optional label for the subtitle.
 */
export default function PnlChart({ bets, since }) {
  const [range, setRange] = useState('all');

  const series = useMemo(() => cumulativePnl(bets, range), [bets, range]);
  const last = series.length ? series[series.length - 1] : 0;
  const neg = last < 0;

  const W = 760;
  const H = 200;
  const pad = 14;

  const geom = useMemo(() => {
    const min = Math.min(...series, 0);
    const max = Math.max(...series, 0);
    const flat = max === min;
    const span = flat ? 1 : max - min;
    const n = Math.max(series.length - 1, 1);
    const X = (i) => pad + (i / n) * (W - 2 * pad);
    const Y = (v) => (flat ? H / 2 : pad + (1 - (v - min) / span) * (H - 2 * pad));
    const pts = series.map((v, i) => [X(i), Y(v)]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const area = `${line} L${X(series.length - 1).toFixed(1)} ${(H - pad).toFixed(1)} L${X(0).toFixed(1)} ${(H - pad).toFixed(1)}Z`;
    return { line, area, zeroY: Y(0).toFixed(1), lastPt: pts[pts.length - 1] };
  }, [series]);

  const col = neg ? 'var(--color-no)' : 'var(--color-yes)';
  const gradId = neg ? 'pfGradNo' : 'pfGradYes';

  return (
    <section className="pf-perf">
      <div className="pf-perf__head">
        <div>
          <div className="pf-perf__title">Cumulative P&amp;L</div>
          <div className={`pf-perf__value ${neg ? 'neg' : 'pos'}`}>{signedUsd(last)}</div>
          <div className="pf-perf__sub">
            Realized, USDC{since ? ` · since ${since}` : ''}
          </div>
        </div>
        <div className="pf-range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              className={range === r.id ? 'on' : ''}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pf-chartbox">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '200px' }}>
          <defs>
            <linearGradient id="pfGradYes" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#2FE0A0" stopOpacity="0.26" />
              <stop offset="1" stopColor="#2FE0A0" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="pfGradNo" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FF6B7A" stopOpacity="0.26" />
              <stop offset="1" stopColor="#FF6B7A" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={geom.area} fill={`url(#${gradId})`} />
          <line
            x1={pad}
            x2={W - pad}
            y1={geom.zeroY}
            y2={geom.zeroY}
            stroke="var(--color-border)"
            strokeWidth="1"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={geom.line}
            fill="none"
            stroke={col}
            strokeWidth="2.2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {geom.lastPt && (
            <circle cx={geom.lastPt[0].toFixed(1)} cy={geom.lastPt[1].toFixed(1)} r="3.6" fill={col} />
          )}
        </svg>
      </div>
    </section>
  );
}
