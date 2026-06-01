import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MarketGlyph, getCardGradient } from './utils/marketGlyphs';
import './MarketCard.css';

const STATUS_CLASS = { 0: 'open', 1: 'resolved', 2: 'cancelled' };

/** Read the motion preference once — mousemove fires a lot, so we never call
 *  matchMedia per-event. */
function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * MarketCard — collectible / holographic prediction market card.
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
  const cardRef = useRef(null);
  const reduceMotion = useRef(prefersReducedMotion());

  const { title, imageUrl, subcategory } = parseMarketTitle(market.question);
  const yesPercent = market.yesOdds ? Math.round(Number(market.yesOdds) / 100) : 50;
  const noPercent = 100 - yesPercent;
  const statusKey = STATUS_CLASS[market.status] || 'open';
  const cat = categories[Number(market.category)] || categories[5];

  const hasImage = Boolean(imageUrl) && !imgError;
  const gradient = getCardGradient(market.category, subcategory);
  const goToMarket = () => navigate(`/market/${market.marketId}`);

  // Holographic tilt + cursor-following sheen. We mutate CSS custom properties
  // on the node directly (via ref) so the effect never triggers a React
  // re-render — only transform/opacity/background-position change.
  const handleTilt = (e) => {
    const el = cardRef.current;
    if (!el || reduceMotion.current) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty('--rx', `${((px - 0.5) * 9).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${((0.5 - py) * 9).toFixed(2)}deg`);
    el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
    el.classList.add('is-tilt');
  };

  const resetTilt = () => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.classList.remove('is-tilt');
  };

  return (
    <article
      ref={cardRef}
      className={`mcard mcard--${statusKey}`}
      onClick={goToMarket}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') goToMarket(); }}
      onMouseMove={handleTilt}
      onMouseLeave={resetTilt}
    >
      <div className="mcard__inner">
        {/* ── Top row: category badge + time-left / status ── */}
        <div className="mcard__top">
          <span
            className="mcard__chip"
            style={{ color: cat.color, background: cat.bg, borderColor: `${cat.color}55` }}
          >
            <MarketGlyph categoryId={market.category} subcategory={subcategory} size={13} />
            {cat.label}
          </span>
          <span className={`mcard__time${market.status === 0 ? '' : ' mcard__time--ended'}`}>
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

        {/* ── Art window — full image (contain) over a blurred same-image backdrop,
              so any aspect ratio is framed and never cropped. Gradient + category
              glyph fallback when the image is missing or fails to load. ── */}
        <div className="mcard__art" style={hasImage ? undefined : { background: gradient }}>
          {hasImage ? (
            <>
              <div
                className="mcard__art-bg"
                style={{ backgroundImage: `url("${imageUrl}")` }}
                aria-hidden="true"
              />
              <img
                className="mcard__art-img"
                src={imageUrl}
                alt=""
                loading="lazy"
                onError={() => setImgError(true)}
              />
            </>
          ) : (
            <span className="mcard__art-glyph">
              <MarketGlyph categoryId={market.category} subcategory={subcategory} />
            </span>
          )}
          <div className="mcard__art-grad" aria-hidden="true" />
          <div className="mcard__art-holo" aria-hidden="true" />
        </div>

        {/* ── Body ── */}
        <div className="mcard__body">
          {subcategory && <div className="mcard__region">{subcategory}</div>}

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
      </div>
    </article>
  );
}

/**
 * Skeleton loader variant for loading states
 */
export function MarketCardSkeleton() {
  return (
    <article className="mcard mcard--loading">
      <div className="mcard__inner">
        <div className="mcard__top">
          <span className="mcard__sk-line" style={{ width: 88, height: 24 }} />
          <span className="mcard__sk-line" style={{ width: 52, height: 24 }} />
        </div>
        <div className="mcard__art" />
        <div className="mcard__body">
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
      </div>
    </article>
  );
}
