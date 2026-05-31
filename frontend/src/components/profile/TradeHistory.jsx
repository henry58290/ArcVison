import { useState, useMemo } from 'react';
import { MarketGlyph, getCardGradient } from '../utils/marketGlyphs';
import './profile.css';

function signedUsd(v) {
  const sign = v < 0 ? '−' : '+';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function StatusPill({ status, outcome }) {
  if (status === 'Active') {
    return <span className="pf-status pf-status--active">Active</span>;
  }
  if (outcome === 'Won') {
    return <span className="pf-status pf-status--won">Won</span>;
  }
  return <span className="pf-status pf-status--lost">Lost</span>;
}

/**
 * TradeHistory — reference table. Market glyph (reused from marketGlyphs,
 * keyed off the market name), YES/NO side pill, wagered, status pill, and
 * color-coded P&L. Active / Past tabs + record count are wired to real bets.
 */
export default function TradeHistory({ bets }) {
  const [tab, setTab] = useState('active');

  const filtered = useMemo(() => {
    if (tab === 'active') return bets.filter((b) => b.status === 'Active');
    return bets.filter((b) => b.status === 'Resolved');
  }, [tab, bets]);

  return (
    <section className="pf-hist">
      <div className="pf-hist__head">
        <h3 className="pf-hist__title">Trade history</h3>
        <span className="pf-hist__count">
          {filtered.length} {filtered.length === 1 ? 'record' : 'records'}
        </span>
      </div>

      <div className="pf-htabs">
        <button
          className={`pf-htab${tab === 'active' ? ' on' : ''}`}
          onClick={() => setTab('active')}
        >
          Active bets
        </button>
        <button
          className={`pf-htab${tab === 'past' ? ' on' : ''}`}
          onClick={() => setTab('past')}
        >
          Past history
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="pf-empty">
          No {tab === 'active' ? 'active' : 'resolved'} bets.
        </div>
      ) : (
        <div className="pf-thist-wrap">
          <div className="pf-thead">
            <div>Market</div>
            <div>Side</div>
            <div className="r">Wagered</div>
            <div>Status</div>
            <div className="r">P&amp;L</div>
          </div>
          {filtered.map((b) => (
            <div className="pf-trow" key={b.id}>
              <div className="pf-tmarket">
                <span className="pf-tglyph" style={{ background: getCardGradient(undefined, b.market) }}>
                  <MarketGlyph subcategory={b.market} size={19} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="pf-tq">{b.market}</div>
                  <div className="pf-tdate">{b.date}</div>
                </div>
              </div>
              <div>
                <span className={`pf-side ${b.position === 'YES' ? 'pf-side--y' : 'pf-side--n'}`}>
                  {b.position}
                </span>
              </div>
              <div className="pf-twager">${b.wagered.toFixed(2)}</div>
              <div><StatusPill status={b.status} outcome={b.outcome} /></div>
              <div className={`pf-tpnl ${b.pnl > 0 ? 'pos' : b.pnl < 0 ? 'neg' : ''}`}>
                {signedUsd(b.pnl)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pf-hist__foot" />
    </section>
  );
}
