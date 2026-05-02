import { useNavigate } from 'react-router-dom';
import './MarketCard.css';

const DEFAULT_PLACEHOLDER = 'https://placehold.co/400x225/1a1b1f/71717a?text=Market';

const MarketStatus = { 0: 'Open', 1: 'Resolved', 2: 'Cancelled' };

const STATUS_CLASS = { 0: 'open', 1: 'resolved', 2: 'cancelled' };

/**
 * MarketCard — Premium prediction market card component
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
  const { title, imageUrl, subcategory } = parseMarketTitle(market.question);
  const yesPercent = market.yesOdds ? Math.round(Number(market.yesOdds) / 100) : 50;
  const noPercent = 100 - yesPercent;
  const displayImageUrl = imageUrl || DEFAULT_PLACEHOLDER;
  const statusKey = STATUS_CLASS[market.status] || 'open';
  const cat = categories[Number(market.category)] || categories[5];

  return (
    <article
      className={`mcard mcard--${statusKey}`}
      onClick={() => navigate(`/market/${market.marketId}`)}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/market/${market.marketId}`); }}
    >
      {/* ── Header ── */}
      <div className="mcard__header">
        <div className="mcard__badges">
          <span className={`mcard__badge mcard__badge--status mcard__badge--${statusKey}`}>
            {MarketStatus[market.status]}
          </span>
          <span
            className="mcard__badge mcard__badge--category"
            style={{ background: cat.bg, color: cat.color }}
          >
            {cat.label}
          </span>
        </div>
        <span className="mcard__time">
          {market.status === 0 && <span className="mcard__live-dot" />}
          {market.status === 0 ? formatTimeLeft(Number(market.endTime)) : 'Ended'}
        </span>
      </div>

      {/* ── Hero Image ── */}
      <div className="mcard__hero">
        <img
          src={displayImageUrl}
          alt=""
          loading="lazy"
          onError={(e) => { e.target.src = DEFAULT_PLACEHOLDER; }}
        />
      </div>

      {/* ── Body ── */}
      <div className="mcard__body">
        <h3 className="mcard__title">{title}</h3>
        {subcategory && <span className="mcard__subcategory">{subcategory}</span>}

        {/* Probability Gauge — open markets only */}
        {market.status === 0 && (
          <div className="mcard__gauge">
            <div className="mcard__gauge-bar">
              <div className="mcard__gauge-fill--yes" style={{ width: `${yesPercent}%` }} />
              <div className="mcard__gauge-fill--no" style={{ width: `${noPercent}%` }} />
            </div>
            <div className="mcard__gauge-labels">
              <span className="mcard__gauge-label mcard__gauge-label--yes">YES {yesPercent}%</span>
              <span className="mcard__gauge-label mcard__gauge-label--no">NO {noPercent}%</span>
            </div>
            <div className="mcard__actions">
              <button
                className="mcard__btn mcard__btn--yes"
                onClick={(e) => { e.stopPropagation(); navigate(`/market/${market.marketId}`); }}
              >
                YES <span className="mcard__btn-price">{yesPercent}¢</span>
              </button>
              <button
                className="mcard__btn mcard__btn--no"
                onClick={(e) => { e.stopPropagation(); navigate(`/market/${market.marketId}`); }}
              >
                NO <span className="mcard__btn-price">{noPercent}¢</span>
              </button>
            </div>
          </div>
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
          <span className="mcard__meta-item">
            {market.totalTrades.toString()} traders
          </span>
        </div>
        <div className="mcard__meta">
          <span className="mcard__meta-item">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 20V10M12 20V4M6 20v-6" />
            </svg>
            {formatVolume(market.totalVolume)}
          </span>
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
      <div className="mcard__header">
        <div className="mcard__badges">
          <span className="mcard__badge" style={{ width: 48, height: 16 }} />
          <span className="mcard__badge" style={{ width: 60, height: 16 }} />
        </div>
      </div>
      <div className="mcard__hero" />
      <div className="mcard__body">
        <h3 className="mcard__title" style={{ width: '80%', height: 18 }}>&nbsp;</h3>
        <div className="mcard__gauge">
          <div className="mcard__gauge-bar" />
          <div className="mcard__actions">
            <span className="mcard__btn" style={{ height: 38 }} />
            <span className="mcard__btn" style={{ height: 38 }} />
          </div>
        </div>
      </div>
      <div className="mcard__footer">
        <span className="mcard__meta-item" style={{ width: 80, height: 14 }} />
        <span className="mcard__meta-item" style={{ width: 60, height: 14 }} />
      </div>
    </article>
  );
}
