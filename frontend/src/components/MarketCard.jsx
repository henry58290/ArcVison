import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MarketGlyph, getCardGradient } from './utils/marketGlyphs';
import './MarketCard.css';

const STATUS_CLASS = { 0: 'open', 1: 'resolved', 2: 'cancelled' };

/** Decorative price-history sparkline. Seeded by marketId, anchored to yesPercent.
 *  Cosmetic only — it does not fetch or represent real trade history. */
function Sparkline({ marketId, yesPercent }) {
  const n = 8;
  const seed = Number(marketId) % 10;
  const start = yesPercent > 50 ? Math.max(38, yesPercent - 24) : Math.min(62, yesPercent + 20);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let v = start + (yesPercent - start) * t + Math.sin(i * 1.7 + seed * 0.6) * 2.4;
    v = Math.max(5, Math.min(95, v));
    const x = Math.round((i / (n - 1)) * 200);
    const y = +(30 - (v / 100) * 24).toFixed(1);
    pts.push([x, y]);
  }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  const gradId = `mcard-spark-${marketId}`;
  return (
    <svg className="mcard__spark-svg" viewBox="0 0 200 34" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7C5CFF" stopOpacity="0.28" />
          <stop offset="1" stopColor="#7C5CFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L200 34 L0 34Z`} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke="#A594FF" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * MarketCard — prediction market card.
 *
 * Props:
 * - market: { marketId, question, status, outcome, yesOdds, totalVolume, totalTrades, endTime, category }
 * - categories: category config map
 * - parseMarketTitle: fn(question) => { title, imageUrl, subcategory }
 * - formatVolume: fn(bigint) => string
 * - formatTimeLeft: fn(endTimeSec) => string
 * - isOwner: boolean (show admin controls)
 * - isConnected: boolean
 * - address: string
 * - onResolve: fn({ marketId, outcome }) — opens resolve modal
 * - onCancel: fn({ marketId }) — opens cancel modal
 * - cancelledMarketInfo: object (for cancelled markets)
 * - ClaimWinningsButton: component (optional)
 * - RefundButton: component (optional)
 * - refreshKey: number
 * - onClaimed: fn
 */
export default function MarketCard({
  market,
  categories,
  parseMarketTitle,
  formatVolume,
  formatTimeLeft,
  isOwner,
  isConnected,
  address,
  onResolve,
  onCancel,
  cancelledMarketInfo,
  ClaimWinningsButton,
  RefundButton,
  refreshKey,
  onClaimed,
}) {
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);

  const { title, imageUrl, subcategory } = parseMarketTitle(market.question);
  const yesPercent = market.yesOdds ? Math.round(Number(market.yesOdds) / 100) : 50;
  const noPercent = 100 - yesPercent;
  const statusKey = STATUS_CLASS[market.status] || 'open';
  const cat = categories[Number(market.category)] || categories[5];

  const hasImage = Boolean(imageUrl) && !imgError;
  const gradient = getCardGradient(market.category, subcategory);
  const goToMarket = () => navigate(`/market/${market.marketId}`);

  return (
    <article
      className={`mcard mcard--${statusKey}`}
      onClick={goToMarket}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') goToMarket(); }}
    >
      {/* ── Thumbnail (custom image, or gradient + category glyph) ── */}
      <div
        className="mcard__thumb"
        style={hasImage ? undefined : { background: gradient }}
      >
        {hasImage ? (
          <img
            className="mcard__thumb-img"
            src={imageUrl}
            alt=""
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="mcard__glyph">
            <MarketGlyph categoryId={market.category} subcategory={subcategory} />
          </span>
        )}

        <div className="mcard__thumb-tags">
          <span
            className="mcard__chip"
            style={{ color: cat.color, background: cat.bg, borderColor: `${cat.color}55` }}
          >
            {cat.label}
          </span>
          <span className="mcard__time">
            {market.status === 0 && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            )}
            {market.status === 0
              ? formatTimeLeft(Number(market.endTime))
              : market.status === 1 ? 'Resolved' : 'Cancelled'}
          </span>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="mcard__body">
        <div className="mcard__qrow">
          <span>{cat.label}</span>
          {subcategory && <span className="mcard__region">{subcategory}</span>}
        </div>

        <h3 className="mcard__title">{title}</h3>

        {/* Probability + price buttons — open markets only */}
        {market.status === 0 && (
          <>
            <div className="mcard__prob">
              <div className="mcard__prob-top">
                <span className="mcard__prob-yes">Yes {yesPercent}%</span>
                <span className="mcard__prob-no">No {noPercent}%</span>
              </div>
              <div className="mcard__bar">
                <div className="mcard__bar-fill" style={{ width: `${yesPercent}%` }} />
              </div>
            </div>

            <div className="mcard__spark">
              <Sparkline marketId={market.marketId} yesPercent={yesPercent} />
            </div>

            <div className="mcard__prices">
              <button
                className="mcard__bet mcard__bet--yes"
                onClick={(e) => { e.stopPropagation(); goToMarket(); }}
              >
                <span className="mcard__bet-lbl">Yes</span>
                <span className="mcard__bet-px">{yesPercent}¢</span>
              </button>
              <button
                className="mcard__bet mcard__bet--no"
                onClick={(e) => { e.stopPropagation(); goToMarket(); }}
              >
                <span className="mcard__bet-lbl">No</span>
                <span className="mcard__bet-px">{noPercent}¢</span>
              </button>
            </div>
          </>
        )}

        {/* Resolution Banner */}
        {market.status === 1 && (
          <div className={`mcard__resolution mcard__resolution--${market.outcome ? 'yes' : 'no'}`}>
            Resolved: {market.outcome ? 'YES' : 'NO'}
            {isConnected && address && ClaimWinningsButton && (
              <ClaimWinningsButton
                marketId={market.marketId}
                userAddress={address}
                refreshKey={refreshKey}
                onClaimed={onClaimed}
              />
            )}
          </div>
        )}

        {/* Cancelled Info */}
        {market.status === 2 && (() => {
          const info = cancelledMarketInfo?.[market.marketId];
          return (
            <div className="mcard__cancelled-info">
              <div className="mcard__cancelled-label">Market Cancelled</div>
              {info?.reason && (
                <div className="mcard__cancelled-reason">"{info.reason}"</div>
              )}
              {isConnected && address && RefundButton && (
                <RefundButton marketId={market.marketId} userAddress={address} />
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Footer ── */}
      <div className="mcard__footer">
        <div className="mcard__traders">
          <div className="mcard__avatar-stack">
            <div className="mcard__avatar mcard__avatar--1" />
            <div className="mcard__avatar mcard__avatar--2" />
            <div className="mcard__avatar mcard__avatar--3" />
          </div>
          <span>{market.totalTrades.toString()} traders</span>
        </div>
        <div className="mcard__foot-right">
          <span className="mcard__vol">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
            </svg>
            {formatVolume(market.totalVolume)}
          </span>
          {market.status === 0 && (
            <span className="mcard__earn">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                <path d="M12 3 3 9l9 12 9-12z" />
              </svg>
              Earn pts
            </span>
          )}
        </div>
      </div>

      {/* ── Admin Controls ── */}
      {isOwner && market.status === 0 && (
        <div className="mcard__admin">
          <button
            className="mcard__admin-btn mcard__admin-btn--yes"
            onClick={(e) => { e.stopPropagation(); onResolve({ marketId: market.marketId, outcome: true }); }}
          >
            Resolve YES
          </button>
          <button
            className="mcard__admin-btn mcard__admin-btn--no"
            onClick={(e) => { e.stopPropagation(); onResolve({ marketId: market.marketId, outcome: false }); }}
          >
            Resolve NO
          </button>
          <button
            className="mcard__admin-btn mcard__admin-btn--cancel"
            onClick={(e) => { e.stopPropagation(); onCancel({ marketId: market.marketId }); }}
          >
            Cancel
          </button>
        </div>
      )}
    </article>
  );
}

/**
 * Skeleton loader variant for loading states
 */
export function MarketCardSkeleton() {
  return (
    <article className="mcard mcard--loading">
      <div className="mcard__thumb" />
      <div className="mcard__body">
        <div className="mcard__qrow" style={{ width: '40%', height: 11 }} />
        <h3 className="mcard__title" style={{ width: '85%' }}>&nbsp;</h3>
        <div className="mcard__prob">
          <div className="mcard__bar" />
        </div>
        <div className="mcard__prices">
          <span className="mcard__bet" style={{ height: 42 }} />
          <span className="mcard__bet" style={{ height: 42 }} />
        </div>
      </div>
      <div className="mcard__footer">
        <span style={{ width: 90, height: 14 }} className="mcard__sk-line" />
        <span style={{ width: 56, height: 14 }} className="mcard__sk-line" />
      </div>
    </article>
  );
}
