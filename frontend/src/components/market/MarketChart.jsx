import { useMemo } from 'react';

/**
 * MarketChart — inline-SVG price-history hero for the market detail page.
 *
 * Presentational only. Renders the real Yes/No probability series passed in
 * via `data` (already fetched from BlockScout + range-filtered by the parent).
 * No network, no chart library — mirrors the profile PnlChart pattern.
 *
 * Props:
 *  - data:        [{ time:number(unix s), yes:number(0-100), no:number(0-100) }]
 *  - range:       active range label (controlled by parent)
 *  - ranges:      string[] of range labels to render in the toggle
 *  - onRangeChange: (label) => void
 *  - loading:     boolean — show spinner until the first real point arrives
 *  - tradeCount:  number — footer "N trades recorded"
 *  - explorerUrl: string — "Powered by BlockScout" link
 */

const W = 900;
const H = 320;
const PAD_L = 6;
const PAD_R = 6;
const PAD_T = 16;
const PAD_B = 26;

const Xf = (i, n) => PAD_L + (n < 2 ? 0.5 : i / (n - 1)) * (W - PAD_L - PAD_R);
const Yf = (v) => PAD_T + (1 - v / 100) * (H - PAD_T - PAD_B);

/** Catmull-Rom → cubic-bézier smoothing (same easing as the reference). */
function smooth(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]} ${pts[0][1]}` : '';
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = 0.16;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function fmtLabel(unixSec, range) {
  const d = new Date(unixSec * 1000);
  if (['1H', '6H', '1D'].includes(range)) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function MarketChart({
  data = [],
  range = 'All',
  ranges = ['1H', '6H', '1D', '1W', '1M', 'All'],
  onRangeChange,
  loading = false,
  tradeCount = 0,
  explorerUrl = 'https://testnet.arcscan.app',
}) {
  const n = data.length;
  const lastYes = n > 0 ? data[n - 1].yes : 50;
  const lastNo = 100 - lastYes;

  const geom = useMemo(() => {
    if (n === 0) return null;
    const yes = data.map((p) => p.yes);
    const no = data.map((p) => 100 - p.yes);
    const ptsY = yes.map((v, i) => [Xf(i, n), Yf(v)]);
    const ptsN = no.map((v, i) => [Xf(i, n), Yf(v)]);

    const want = Math.min(6, n);
    const labels = [];
    for (let i = 0; i < want; i++) {
      const idx = Math.round((i * (n - 1)) / (want - 1 || 1));
      labels.push(fmtLabel(data[idx].time, range));
    }

    // End-dot positions as % of the plot box (SVG fills it via
    // preserveAspectRatio="none", so viewBox coords map linearly).
    const lastX = Xf(n - 1, n);
    return {
      pathY: smooth(ptsY),
      pathN: smooth(ptsN),
      labels,
      dotLeft: (lastX / W) * 100,
      dotTopY: (Yf(data[n - 1].yes) / H) * 100,
      dotTopN: (Yf(100 - data[n - 1].yes) / H) * 100,
    };
  }, [data, n, range]);

  const grid = [0, 25, 50, 75, 100].map((g) => (
    <line
      key={g}
      x1={PAD_L}
      x2={W - PAD_R}
      y1={Yf(g).toFixed(1)}
      y2={Yf(g).toFixed(1)}
      stroke={g === 50 ? 'var(--color-border)' : 'var(--color-border-subtle)'}
      strokeWidth="1"
      strokeDasharray={g === 50 ? '4 4' : undefined}
      vectorEffect="non-scaling-stroke"
    />
  ));

  return (
    <section className="md-card md-chart md-rise md-d2">
      <div className="md-chart__head">
        <div>
          <div className="md-chart__price">
            <span className="md-chart__big">{Math.round(lastYes)}¢</span>
            <span className="md-chart__lead">Yes</span>
          </div>
          <div className="md-chart__sub">
            Implied probability · last trade {lastYes.toFixed(2)}¢
          </div>
        </div>
        <div className="md-range">
          {ranges.map((r) => (
            <button
              key={r}
              className={range === r ? 'on' : ''}
              onClick={() => onRangeChange?.(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="md-legend">
        <div className="md-legend__it">
          <span className="md-legend__ln" style={{ background: 'var(--color-yes)' }} />
          <span style={{ color: 'var(--color-yes)' }}>Yes {lastYes.toFixed(2)}%</span>
        </div>
        <div className="md-legend__it">
          <span className="md-legend__ln" style={{ background: 'var(--color-no)' }} />
          <span style={{ color: 'var(--color-no)' }}>No {lastNo.toFixed(2)}%</span>
        </div>
      </div>

      {loading && n === 0 ? (
        <div className="md-chart__loading"><div className="md-spin" /></div>
      ) : (
        <>
          <div className="md-plot-wrap">
            <div className="md-yaxis">
              <span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span>
            </div>
            <div className="md-plot">
              {geom && (
                <>
                  <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
                    {grid}
                    <path
                      d={geom.pathN}
                      fill="none"
                      stroke="var(--color-no)"
                      strokeWidth="2.2"
                      vectorEffect="non-scaling-stroke"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    <path
                      d={geom.pathY}
                      fill="none"
                      stroke="var(--color-yes)"
                      strokeWidth="2.2"
                      vectorEffect="non-scaling-stroke"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div
                    className="md-edot md-edot--n"
                    style={{ left: `${geom.dotLeft}%`, top: `${geom.dotTopN}%` }}
                  />
                  <div
                    className="md-edot md-edot--y"
                    style={{ left: `${geom.dotLeft}%`, top: `${geom.dotTopY}%` }}
                  />
                </>
              )}
            </div>
          </div>
          <div className="md-xaxis">
            {geom?.labels.map((l, i) => <span key={i}>{l}</span>)}
          </div>
        </>
      )}

      <div className="md-chart__foot">
        <span>{tradeCount} trade{tradeCount !== 1 ? 's' : ''} recorded</span>
        <span>
          Powered by{' '}
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer">BlockScout</a>
        </span>
      </div>
    </section>
  );
}
