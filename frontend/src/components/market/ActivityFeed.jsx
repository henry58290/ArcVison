import { formatEther } from 'viem';

/**
 * ActivityFeed — recent-trades list for the market detail "Activity" tab.
 *
 * Presentational. `items` comes from calculateActivity() over the same
 * BlockScout logs the chart uses (see logParser.js) — no fetching here.
 *
 * @param {{items: {user:string, side:boolean, amount:string, time:number, txHash:string}[]}} props
 */

function shortAddr(addr) {
  if (!addr) return '0x0000';
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function fmtAmount(wei) {
  try {
    return `$${parseFloat(formatEther(BigInt(wei))).toFixed(2)}`;
  } catch {
    return '$0.00';
  }
}

function timeAgo(unixSec) {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function ActivityFeed({ items = [] }) {
  if (!items.length) {
    return (
      <div className="md-act__empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10h18" />
        </svg>
        <div>No trades yet.<br />Be the first to take a position.</div>
      </div>
    );
  }

  return (
    <div className="md-act">
      {items.map((x) => {
        const yes = x.side === true;
        const tint = yes ? 'var(--color-yes-dim)' : 'var(--color-no-dim)';
        const col = yes ? 'var(--color-yes)' : 'var(--color-no)';
        return (
          <div className="md-act__row" key={x.txHash}>
            <div className="md-act__l">
              <div className="md-act__dot" style={{ background: tint, color: col }}>
                {x.user.slice(2, 4)}
              </div>
              <div>
                <div className="md-act__addr">{shortAddr(x.user)}</div>
                <div className="md-act__sub">
                  bought <span className={yes ? 'yes' : 'no'}>{yes ? 'Yes' : 'No'}</span>
                </div>
              </div>
            </div>
            <div className="md-act__r">
              <div className="md-act__amt">{fmtAmount(x.amount)}</div>
              <div className="md-act__ago">{timeAgo(x.time)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
