import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * MarketChart — inline-SVG price-history hero for the market detail page.
 *
 * Presentational only. Renders the real Yes/No probability series passed in
 * via `data` (already fetched from BlockScout + range-filtered by the parent).
 * No network, no chart library — mirrors the profile PnlChart pattern.
 *
 * Polymarket-style hover (added on top, purely additive):
 *   • vertical crosshair snapped to the nearest point on the smoothed curve
 *   • date/time label at the top of the crosshair
 *   • a dot riding on each line (Yes / No) with a ring that matches the card bg
 *   • the implied % floating next to each dot (anti-overlap near 50%, flips left
 *     near the right edge)
 *   • the portion of both lines AFTER the cursor dimmed to grey ("future")
 *   • resets to the resting state (latest values, full-color lines) on leave
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
const PLOT_H = H - PAD_T - PAD_B;

const SMOOTH = 0.16; // Catmull-Rom tension (shared by the path and the dense samples)
const SEG = 20; // dense sub-samples per segment — visually identical to the bézier

const Xf = (i, n) => PAD_L + (n < 2 ? 0.5 : i / (n - 1)) * (W - PAD_L - PAD_R);
const Yf = (v) => PAD_T + (1 - v / 100) * PLOT_H;
const invYf = (y) => 100 * (1 - (y - PAD_T) / PLOT_H); // pixel y → implied %
const clampPct = (v) => Math.max(0, Math.min(100, v));

/** One Catmull-Rom→cubic-bézier segment evaluated at u∈[0,1] (matches `smooth`). */
function cubic(p0, p1, p2, p3, u) {
  const c1 = p1 + (p2 - p0) * SMOOTH;
  const c2 = p2 - (p3 - p1) * SMOOTH;
  const v = 1 - u;
  return v * v * v * p1 + 3 * v * v * u * c1 + 3 * v * u * u * c2 + u * u * u * p2;
}

/** Catmull-Rom → cubic-bézier smoothing (same easing as the reference). */
function smooth(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]} ${pts[0][1]}` : '';
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = SMOOTH;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/**
 * Dense [{ x, yY, yN, t }] samples along the *same* curve the path draws, so the
 * crosshair dot rides exactly on the rendered line and the bright/faded split is
 * pixel-accurate. `t` (time) is interpolated by index — points are evenly spaced
 * along x, so this matches the x-axis labels.
 */
function densify(data, ptsY, ptsN) {
  const n = data.length;
  if (n < 2) {
    return data.map((p, i) => ({ x: ptsY[i][0], yY: ptsY[i][1], yN: ptsN[i][1], t: p.time }));
  }
  const out = [];
  for (let i = 0; i < n - 1; i++) {
    const ax = (ptsY[i - 1] || ptsY[i])[0];
    const bx = ptsY[i][0];
    const cx = ptsY[i + 1][0];
    const dx = (ptsY[i + 2] || ptsY[i + 1])[0];
    const ay = (ptsY[i - 1] || ptsY[i])[1];
    const by = ptsY[i][1];
    const cy = ptsY[i + 1][1];
    const dy = (ptsY[i + 2] || ptsY[i + 1])[1];
    const an = (ptsN[i - 1] || ptsN[i])[1];
    const bn = ptsN[i][1];
    const cn = ptsN[i + 1][1];
    const dn = (ptsN[i + 2] || ptsN[i + 1])[1];
    const t0 = data[i].time;
    const t1 = data[i + 1].time;
    for (let s = 0; s < SEG; s++) {
      const u = s / SEG;
      out.push({
        x: cubic(ax, bx, cx, dx, u),
        yY: cubic(ay, by, cy, dy, u),
        yN: cubic(an, bn, cn, dn, u),
        t: t0 + (t1 - t0) * u,
      });
    }
  }
  const li = n - 1;
  out.push({ x: ptsY[li][0], yY: ptsY[li][1], yN: ptsN[li][1], t: data[li].time });
  return out;
}

function fmtLabel(unixSec, range) {
  const d = new Date(unixSec * 1000);
  if (['1H', '6H', '1D'].includes(range)) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Crosshair label — richer than the axis (adds the time on intraday ranges). */
function fmtHoverLabel(unixSec, range) {
  const d = new Date(unixSec * 1000);
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  if (['1H', '6H', '1D'].includes(range)) {
    return `${date}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return date;
}

function fmtPct(v) {
  const r = Math.round(clampPct(v) * 10) / 10;
  return (Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)) + '%';
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
  const svgRef = useRef(null);
  const [hoverX, setHoverX] = useState(null); // viewBox x while hovering, else null

  const n = data.length;
  const lastYes = n > 0 ? data[n - 1].yes : 50;
  const lastNo = 100 - lastYes;

  const geom = useMemo(() => {
    if (n === 0) return null;
    const ptsY = data.map((p, i) => [Xf(i, n), Yf(p.yes)]);
    const ptsN = data.map((p, i) => [Xf(i, n), Yf(100 - p.yes)]);

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
      samples: densify(data, ptsY, ptsN),
      labels,
      dotLeft: (lastX / W) * 100,
      dotTopY: (Yf(data[n - 1].yes) / H) * 100,
      dotTopN: (Yf(100 - data[n - 1].yes) / H) * 100,
    };
  }, [data, n, range]);

  // Nearest dense-sample index to the hovered x (binary search; samples ascend in x).
  const k = useMemo(() => {
    const s = geom?.samples;
    if (!s || s.length === 0) return -1;
    if (hoverX == null) return s.length - 1;
    const x = Math.max(s[0].x, Math.min(s[s.length - 1].x, hoverX));
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid].x < x) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(s[lo - 1].x - x) < Math.abs(s[lo].x - x)) lo -= 1;
    return lo;
  }, [hoverX, geom]);

  const hovering = hoverX != null && !!geom && geom.samples.length > 0;
  const cur = hovering ? geom.samples[k] : null;

  // bright = start→cursor, faded = cursor→end (overlap at k keeps the join seamless)
  const polyline = (arr, key) =>
    arr.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p[key].toFixed(1)).join(' ');
  const brightY = cur ? polyline(geom.samples.slice(0, k + 1), 'yY') : '';
  const brightN = cur ? polyline(geom.samples.slice(0, k + 1), 'yN') : '';
  const fadeY = cur ? polyline(geom.samples.slice(k), 'yY') : '';
  const fadeN = cur ? polyline(geom.samples.slice(k), 'yN') : '';

  // floating readout positions (keep Yes/No from overlapping near the crossover)
  let hud = null;
  if (cur) {
    const leftPct = (cur.x / W) * 100;
    let lyY = cur.yY;
    let lnY = cur.yN;
    if (Math.abs(lyY - lnY) < 34) {
      const mid = (lyY + lnY) / 2;
      lyY = mid - 17;
      lnY = mid + 17;
    }
    const clampY = (y) => Math.max(PAD_T, Math.min(H - PAD_B, y));
    hud = {
      leftPct,
      yesDotPct: (cur.yY / H) * 100,
      noDotPct: (cur.yN / H) * 100,
      yesLabelPct: (clampY(lyY) / H) * 100,
      noLabelPct: (clampY(lnY) / H) * 100,
      flipLeft: leftPct > 76,
      datePct: Math.max(9, Math.min(91, leftPct)),
      yesV: invYf(cur.yY),
      noV: invYf(cur.yN),
    };
  }

  // pointer → viewBox x (robust to responsive scaling and touch)
  const handleMove = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return;
    const touch = e.touches && e.touches[0];
    const pt = svg.createSVGPoint();
    pt.x = touch ? touch.clientX : e.clientX;
    pt.y = touch ? touch.clientY : e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    setHoverX(pt.matrixTransform(ctm.inverse()).x);
  }, []);
  const handleLeave = useCallback(() => setHoverX(null), []);

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
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${W} ${H}`}
                    preserveAspectRatio="none"
                    className="md-plot__svg"
                    onMouseMove={handleMove}
                    onMouseLeave={handleLeave}
                    onTouchStart={handleMove}
                    onTouchMove={handleMove}
                    onTouchEnd={handleLeave}
                  >
                    {grid}
                    {cur ? (
                      <>
                        {/* faded "future" segments (cursor → end) */}
                        <path d={fadeN} fill="none" stroke="var(--color-fg-dim)" strokeWidth="2.2"
                          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                        <path d={fadeY} fill="none" stroke="var(--color-fg-dim)" strokeWidth="2.2"
                          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                        {/* bright "past" segments (start → cursor) */}
                        <path d={brightN} fill="none" stroke="var(--color-no)" strokeWidth="2.2"
                          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                        <path d={brightY} fill="none" stroke="var(--color-yes)" strokeWidth="2.2"
                          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                        {/* crosshair */}
                        <line x1={cur.x} y1={PAD_T} x2={cur.x} y2={H - PAD_B}
                          stroke="var(--color-fg-muted)" strokeOpacity="0.5" strokeWidth="1"
                          strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                      </>
                    ) : (
                      <>
                        <path d={geom.pathN} fill="none" stroke="var(--color-no)" strokeWidth="2.2"
                          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                        <path d={geom.pathY} fill="none" stroke="var(--color-yes)" strokeWidth="2.2"
                          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                      </>
                    )}
                  </svg>

                  {/* resting end-dots — hidden while hovering */}
                  <div
                    className="md-edot md-edot--n"
                    style={{ left: `${geom.dotLeft}%`, top: `${geom.dotTopN}%`, opacity: hovering ? 0 : 1 }}
                  />
                  <div
                    className="md-edot md-edot--y"
                    style={{ left: `${geom.dotLeft}%`, top: `${geom.dotTopY}%`, opacity: hovering ? 0 : 1 }}
                  />

                  {/* hover overlays (HTML — crisp on the preserveAspectRatio="none" SVG) */}
                  {hud && (
                    <>
                      <div className="md-clabel" style={{ left: `${hud.datePct}%` }}>
                        {fmtHoverLabel(cur.t, range)}
                      </div>
                      <div className="md-hdot md-hdot--n" style={{ left: `${hud.leftPct}%`, top: `${hud.noDotPct}%` }} />
                      <div className="md-hdot md-hdot--y" style={{ left: `${hud.leftPct}%`, top: `${hud.yesDotPct}%` }} />
                      <div
                        className={`md-flabel ${hud.flipLeft ? 'is-left' : ''}`}
                        style={{ left: `${hud.leftPct}%`, top: `${hud.yesLabelPct}%` }}
                      >
                        <span className="md-flabel__dot" style={{ background: 'var(--color-yes)' }} />
                        <span className="md-flabel__name" style={{ color: 'var(--color-yes)' }}>Yes</span>
                        <span className="md-flabel__val">{fmtPct(hud.yesV)}</span>
                      </div>
                      <div
                        className={`md-flabel ${hud.flipLeft ? 'is-left' : ''}`}
                        style={{ left: `${hud.leftPct}%`, top: `${hud.noLabelPct}%` }}
                      >
                        <span className="md-flabel__dot" style={{ background: 'var(--color-no)' }} />
                        <span className="md-flabel__name" style={{ color: 'var(--color-no)' }}>No</span>
                        <span className="md-flabel__val">{fmtPct(hud.noV)}</span>
                      </div>
                    </>
                  )}
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
