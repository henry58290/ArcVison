import './profile.css';

/** Signed USDC, e.g. +$73.20 / −$380.00 */
function signedUsd(v) {
  const sign = v < 0 ? '−' : '+';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Unsigned whole-dollar volume, e.g. $1,075 */
function plainUsd(v) {
  return `$${Math.round(v).toLocaleString()}`;
}

function Tile({ label, value, tone = 'neutral', children }) {
  const toneClass = tone === 'profit' ? ' pos' : tone === 'loss' ? ' neg' : '';
  return (
    <div className="pf-tile">
      <div className="pf-tile__label">{label}</div>
      <div className={`pf-tile__value${toneClass}`}>{value}</div>
      <div className="pf-tile__delta">{children}</div>
    </div>
  );
}

/**
 * StatsCards — four metric tiles, all derived from computeStats(bets):
 * Net P&L (realized + ROI), Open P&L (unrealized), Win rate (W/L), Volume.
 */
export default function StatsCards({ stats }) {
  const {
    netPnl = 0,
    roiPct = 0,
    openPnl = 0,
    activeCount = 0,
    winRate = 0,
    winCount = 0,
    lossCount = 0,
    volume = 0,
    marketsCount = 0,
  } = stats || {};

  const roiSign = roiPct >= 0 ? '+' : '−';

  return (
    <section className="pf-metrics">
      <Tile
        label="Net P&L · realized"
        value={signedUsd(netPnl)}
        tone={netPnl >= 0 ? 'profit' : 'loss'}
      >
        {roiSign}{Math.abs(roiPct).toFixed(1)}% ROI
      </Tile>

      <Tile
        label="Open P&L · unrealized"
        value={signedUsd(openPnl)}
        tone={openPnl >= 0 ? 'profit' : 'loss'}
      >
        across {activeCount} active position{activeCount === 1 ? '' : 's'}
      </Tile>

      <Tile label="Win rate" value={`${Math.round(winRate)}%`}>
        <span className="pf-wl">
          <span className="w">{winCount}W</span>·<span className="l">{lossCount}L</span>
        </span>
        resolved
      </Tile>

      <Tile label="Volume traded" value={plainUsd(volume)}>
        {marketsCount} market{marketsCount === 1 ? '' : 's'} · all-time
      </Tile>
    </section>
  );
}
