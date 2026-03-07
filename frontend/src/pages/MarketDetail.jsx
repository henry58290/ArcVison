import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
} from 'recharts';
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../components/utils/contracts';
import { fetchMarketLogs, calculateProbabilityTimeSeries } from '../components/utils/logParser';
import { clearCache } from '../components/utils/indexedDb';

/* ────────────────────────── constants ────────────────────────── */

const IMAGE_SEPARATOR = '||';
const STATUS_LABELS = { 0: 'Active', 1: 'Resolved', 2: 'Cancelled' };
const STATUS_COLORS = { 0: '#22c55e', 1: '#3b82f6', 2: '#ef4444' };
const STATUS_BG = {
  0: 'rgba(34,197,94,0.15)',
  1: 'rgba(59,130,246,0.15)',
  2: 'rgba(239,68,68,0.15)',
};

const CATEGORIES = [
  { id: 0, label: 'Crypto', color: '#f7931a', bg: 'rgba(247,147,26,0.15)' },
  { id: 1, label: 'Sports', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  { id: 2, label: 'Politics', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  { id: 3, label: 'Entertainment', color: '#a855f7', bg: 'rgba(168,85,247,0.15)' },
  { id: 4, label: 'Science', color: '#06b6d4', bg: 'rgba(6,182,212,0.15)' },
  { id: 5, label: 'Other', color: '#71717a', bg: 'rgba(113,113,122,0.15)' },
];

const TIME_FILTERS = [
  { label: '1H', seconds: 3600 },
  { label: '6H', seconds: 21600 },
  { label: '1D', seconds: 86400 },
  { label: '1W', seconds: 604800 },
  { label: '1M', seconds: 2592000 },
  { label: 'All', seconds: 0 },
];

const LEFT_COL_WIDTH = '380px';
const MOBILE_BREAKPOINT = 860;

/* ────────────────────────── helpers ────────────────────────── */

function parseMarketTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return { title: '', imageUrl: null };
  const parts = rawTitle.split(IMAGE_SEPARATOR);
  if (parts.length >= 2 && parts[1].trim()) {
    return { title: parts[0].trim(), imageUrl: parts[1].trim() };
  }
  return { title: rawTitle, imageUrl: null };
}

function formatVolume(vol) {
  if (!vol || vol === 0n) return '$0';
  const eth = parseFloat(formatEther(vol));
  if (eth >= 1000000) return `$${(eth / 1000000).toFixed(1)}M`;
  if (eth >= 1000) return `$${(eth / 1000).toFixed(1)}K`;
  return `$${eth.toFixed(2)}`;
}

/* ────────────────────────── countdown hook ────────────────────────── */

function useCountdown(endTimeUnix) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0, ended: true });

  useEffect(() => {
    const calc = () => {
      const now = Math.floor(Date.now() / 1000);
      const diff = endTimeUnix - now;
      if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, ended: true };
      return {
        days: Math.floor(diff / 86400),
        hours: Math.floor((diff % 86400) / 3600),
        minutes: Math.floor((diff % 3600) / 60),
        seconds: diff % 60,
        ended: false,
      };
    };
    setTimeLeft(calc());
    const id = setInterval(() => setTimeLeft(calc()), 1000);
    return () => clearInterval(id);
  }, [endTimeUnix]);

  return timeLeft;
}

/* ────────────────────────── responsive hook ────────────────────────── */

function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);

  return isMobile;
}

/* ══════════════════════════ COMPONENT ══════════════════════════ */

export default function MarketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const marketId = Number(id);
  const isMobile = useIsMobile();

  /* ── contract reads ── */

  const { data: market, isLoading: marketLoading, refetch: refetchMarket } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getMarketSummary',
    args: [BigInt(marketId)],
    query: { enabled: !isNaN(marketId) },
  });

  const { data: odds, refetch: refetchOdds } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getOdds',
    args: [BigInt(marketId)],
    query: { enabled: !isNaN(marketId) },
  });

  /* ── admin detection ── */

  const { data: owner } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'owner',
  });

  const isOwner = owner && address && owner.toLowerCase() === address.toLowerCase();

  /* ── admin state ── */

  const [showResolveModal, setShowResolveModal] = useState(null); // null | { outcome: boolean }
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const {
    writeContract: resolveMarketWrite,
    isPending: isResolving,
    data: resolveHash,
  } = useWriteContract();

  const {
    writeContract: cancelMarketWrite,
    isPending: isCancelling,
    data: cancelHash,
  } = useWriteContract();

  /* ── trade state ── */

  const [amount, setAmount] = useState('');
  const [selectedSide, setSelectedSide] = useState(null);
  const {
    writeContract,
    isPending: isTradePending,
    error: tradeError,
    isSuccess: tradeSubmitted,
    data: tradeHash,
  } = useWriteContract();

  const { data: estimatedPayout } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'estimatePayout',
    args: [BigInt(marketId), selectedSide ?? true, amount ? parseEther(amount) : 0n],
    query: {
      enabled: !isNaN(marketId) && selectedSide != null && !!amount && parseFloat(amount) > 0,
    },
  });

  /* ── receipt tracking ── */

  const { isSuccess: tradeConfirmed } = useWaitForTransactionReceipt({ hash: tradeHash });
  const { isSuccess: resolveConfirmed } = useWaitForTransactionReceipt({ hash: resolveHash });
  const { isSuccess: cancelConfirmed } = useWaitForTransactionReceipt({ hash: cancelHash });

  /* ── chart state ── */

  const [chartData, setChartData] = useState([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState('All');
  const [tradeCount, setTradeCount] = useState(0);
  const intervalRef = useRef(null);

  const loadChartData = useCallback(async (silent = false) => {
    try {
      if (!silent) setChartLoading(true);
      const logs = await fetchMarketLogs(marketId);
      const dataPoints = calculateProbabilityTimeSeries(logs, marketId);
      setTradeCount(dataPoints.length);

      const formatted = dataPoints.map((p) => ({
        time: p.time,
        yes: parseFloat(p.value.toFixed(2)),
        no: parseFloat((100 - p.value).toFixed(2)),
        timeStr: new Date(p.time * 1000).toLocaleString(),
      }));

      setChartData(formatted);
      setChartLoading(false);
    } catch (err) {
      console.error('Error loading chart data:', err);
      setChartLoading(false);
    }
  }, [marketId]);

  useEffect(() => {
    setChartLoading(true);
    loadChartData();
    intervalRef.current = setInterval(() => {
      loadChartData(true); // silent — no loading spinner
      refetchMarket();
      refetchOdds();
    }, 15000);
    return () => clearInterval(intervalRef.current);
  }, [loadChartData, refetchMarket, refetchOdds]);

  /* ── about section ── */

  const [aboutExpanded, setAboutExpanded] = useState(false);

  /* ── derived data ── */

  const { title, imageUrl } = useMemo(
    () => parseMarketTitle(market?.question),
    [market?.question],
  );

  const yesPercent = odds
    ? Math.round(Number(odds[0]) / 100)
    : market?.yesOdds
      ? Math.round(Number(market.yesOdds) / 100)
      : 50;
  const noPercent = 100 - yesPercent;

  const endTime = market ? Number(market.endTime) : 0;
  const countdown = useCountdown(endTime);

  /* ── filtered chart data ── */

  const filteredChartData = useMemo(() => {
    if (timeFilter === 'All' || chartData.length === 0) return chartData;
    const filter = TIME_FILTERS.find((f) => f.label === timeFilter);
    if (!filter || filter.seconds === 0) return chartData;
    const cutoff = Math.floor(Date.now() / 1000) - filter.seconds;
    const filtered = chartData.filter((d) => d.time >= cutoff);
    return filtered.length > 0 ? filtered : chartData;
  }, [chartData, timeFilter]);

  const displayChartData = useMemo(() => {
    if (filteredChartData.length > 0) return filteredChartData;
    if (!chartLoading && yesPercent != null) {
      const now = Math.floor(Date.now() / 1000);
      return [
        { time: now - 3600, yes: yesPercent, no: noPercent, timeStr: '' },
        { time: now, yes: yesPercent, no: noPercent, timeStr: '' },
      ];
    }
    return [];
  }, [filteredChartData, chartLoading, yesPercent, noPercent]);

  /* ── trade handler ── */

  const handleTrade = (side) => {
    setSelectedSide(side);
    try {
      const amountStr = amount.trim() || '0.01';
      if (parseFloat(amountStr) <= 0 || isNaN(parseFloat(amountStr))) return;
      writeContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'placePosition',
        args: [BigInt(marketId), side],
        value: parseEther(amountStr),
      });
    } catch (err) {
      console.error(err);
    }
  };

  /* ── unified refresh after confirmed tx ── */

  const refreshAllData = useCallback(async () => {
    clearCache(marketId);
    refetchMarket();
    refetchOdds();
    loadChartData(true);
  }, [marketId, refetchMarket, refetchOdds, loadChartData]);

  // After trade is confirmed on-chain
  useEffect(() => {
    if (tradeConfirmed) {
      refreshAllData();
    }
  }, [tradeConfirmed, refreshAllData]);

  // After resolve is confirmed on-chain
  useEffect(() => {
    if (resolveConfirmed) {
      refreshAllData();
      setShowResolveModal(null);
    }
  }, [resolveConfirmed, refreshAllData]);

  // After cancel is confirmed on-chain
  useEffect(() => {
    if (cancelConfirmed) {
      refreshAllData();
      setShowCancelModal(false);
      setCancelReason('');
    }
  }, [cancelConfirmed, refreshAllData]);

  /* ── admin handlers ── */

  const handleResolveMarket = (outcome) => {
    resolveMarketWrite({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'resolveMarket',
      args: [BigInt(marketId), outcome],
    });
  };

  const handleCancelMarket = () => {
    if (!cancelReason.trim()) return;
    cancelMarketWrite({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: 'cancelMarket',
      args: [BigInt(marketId), cancelReason],
    });
  };

  const payoutDisplay = estimatedPayout
    ? parseFloat(formatEther(estimatedPayout)).toFixed(4)
    : '--';

  /* ── loading / error states ── */

  if (marketLoading) {
    return (
      <main style={{ paddingTop: '100px', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          width: '32px', height: '32px',
          border: '3px solid var(--color-border)',
          borderTopColor: 'var(--color-accent)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
      </main>
    );
  }

  if (!market) {
    return (
      <main style={{ paddingTop: '100px', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
        <div style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--color-fg)' }}>Market not found</div>
        <button
          onClick={() => navigate('/')}
          style={{
            padding: '10px 24px', fontSize: '0.875rem', fontWeight: '600',
            background: 'var(--color-accent)', color: '#08090a',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            fontFamily: 'var(--font-body)', textTransform: 'uppercase',
          }}
        >
          Back to Markets
        </button>
      </main>
    );
  }

  /* ════════════════════════════════════════════════════════════
     SHARED SUB-COMPONENTS (rendered in different positions
     depending on desktop vs mobile)
     ════════════════════════════════════════════════════════════ */

  /* ── Outcome Probabilities ── */
  const outcomeProbabilities = (
    <div style={{ marginBottom: '1.25rem' }}>
      {/* Yes bar */}
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#22c55e' }}>Yes</span>
          <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#22c55e' }}>{yesPercent}%</span>
        </div>
        <div style={{ height: '8px', background: 'var(--color-bg)', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${yesPercent}%`, background: '#22c55e', borderRadius: '4px', transition: 'width 0.5s ease' }} />
        </div>
      </div>
      {/* No bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#ef4444' }}>No</span>
          <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#ef4444' }}>{noPercent}%</span>
        </div>
        <div style={{ height: '8px', background: 'var(--color-bg)', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${noPercent}%`, background: '#ef4444', borderRadius: '4px', transition: 'width 0.5s ease' }} />
        </div>
      </div>
      {/* Large outcome cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '1rem' }}>
        <div style={{
          background: 'rgba(34,197,94,0.08)',
          border: '1px solid rgba(34,197,94,0.25)',
          borderRadius: '10px', padding: '1rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '0.625rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '2px' }}>Yes</div>
          <div style={{ fontSize: '1.75rem', fontWeight: '700', color: '#22c55e', lineHeight: 1 }}>{yesPercent}%</div>
        </div>
        <div style={{
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.25)',
          borderRadius: '10px', padding: '1rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '0.625rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '2px' }}>No</div>
          <div style={{ fontSize: '1.75rem', fontWeight: '700', color: '#ef4444', lineHeight: 1 }}>{noPercent}%</div>
        </div>
      </div>
    </div>
  );

  /* ── Trade Form (the interactive part) ── */
  const tradeForm = market.status === 0 ? (
    !isConnected ? (
      <div style={{ textAlign: 'center', padding: '0.75rem 0' }}>
        <div style={{ fontSize: '0.9375rem', fontWeight: '600', color: 'var(--color-fg)', marginBottom: '0.375rem' }}>
          Connect your wallet to trade
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--color-fg-dim)', marginBottom: '1.25rem' }}>
          You need a connected wallet to place positions.
        </div>
        <ConnectButton />
      </div>
    ) : (
      <>
        {/* Amount input */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{
            display: 'block', fontSize: '0.6875rem',
            color: 'var(--color-fg-dim)', textTransform: 'uppercase',
            letterSpacing: '0.1em', marginBottom: '0.375rem',
            fontFamily: 'var(--font-body)',
          }}>
            Amount (USDC)
          </label>
          <input
            type="number"
            min="0.001"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{
              width: '100%', padding: '0.875rem',
              fontSize: '1.125rem', fontWeight: '600',
              fontFamily: 'var(--font-body)',
              background: 'var(--color-bg)',
              color: 'var(--color-fg)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              textAlign: 'center',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Estimated payout */}
        {amount && selectedSide != null && (
          <div style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: '8px', padding: '0.75rem',
            marginBottom: '1rem',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: '0.6875rem', color: 'var(--color-fg-dim)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Est. Payout
            </span>
            <span style={{ fontSize: '1rem', fontWeight: '700', color: '#22c55e' }}>
              ~{payoutDisplay} USDC
            </span>
          </div>
        )}

        {/* Yes / No buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <button
            onClick={() => handleTrade(true)}
            disabled={isTradePending}
            style={{
              padding: '0.875rem', fontSize: '0.875rem', fontWeight: '700',
              fontFamily: 'var(--font-body)',
              background: '#22c55e',
              color: '#08090a',
              border: 'none',
              borderRadius: '10px', cursor: 'pointer',
              textTransform: 'uppercase',
              opacity: isTradePending && selectedSide !== true ? 0.5 : 1,
              transition: 'all 0.15s ease',
            }}
          >
            {isTradePending && selectedSide === true ? 'Confirming...' : `Buy Yes ${yesPercent}\u00A2`}
          </button>
          <button
            onClick={() => handleTrade(false)}
            disabled={isTradePending}
            style={{
              padding: '0.875rem', fontSize: '0.875rem', fontWeight: '700',
              fontFamily: 'var(--font-body)',
              background: '#ef4444',
              color: '#fff',
              border: 'none',
              borderRadius: '10px', cursor: 'pointer',
              textTransform: 'uppercase',
              opacity: isTradePending && selectedSide !== false ? 0.5 : 1,
              transition: 'all 0.15s ease',
            }}
          >
            {isTradePending && selectedSide === false ? 'Confirming...' : `Buy No ${noPercent}\u00A2`}
          </button>
        </div>

        {/* Error */}
        {tradeError && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444',
            borderRadius: '8px', padding: '0.75rem', marginBottom: '0.75rem',
          }}>
            <div style={{ fontSize: '0.6875rem', color: '#ef4444', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px' }}>
              Transaction Failed
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-fg)' }}>
              {tradeError.message.slice(0, 100)}{tradeError.message.length > 100 ? '...' : ''}
            </div>
          </div>
        )}

        {/* Success */}
        {tradeSubmitted && !tradeConfirmed && (
          <div style={{
            background: 'rgba(249,115,22,0.1)', border: '1px solid #f97316',
            borderRadius: '8px', padding: '0.75rem', marginBottom: '0.75rem',
          }}>
            <div style={{ fontSize: '0.75rem', color: '#f97316', fontWeight: '600' }}>
              Transaction submitted, waiting for confirmation...
            </div>
          </div>
        )}
        {tradeConfirmed && (
          <div style={{
            background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e',
            borderRadius: '8px', padding: '0.75rem', marginBottom: '0.75rem',
          }}>
            <div style={{ fontSize: '0.75rem', color: '#22c55e', fontWeight: '600' }}>
              Transaction confirmed on-chain!
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <p style={{
          fontSize: '0.625rem', color: 'var(--color-fg-dim)',
          textAlign: 'center', lineHeight: 1.5, margin: 0,
        }}>
          By placing a position you agree to the smart contract terms.
        </p>
      </>
    )
  ) : null;

  /* ── Resolved / Cancelled banner ── */
  const statusBanner = market.status === 1 ? (
    <div style={{
      background: 'var(--color-bg)', border: '1px solid var(--color-border-subtle)',
      borderRadius: '10px', padding: '1.25rem', textAlign: 'center',
    }}>
      <div style={{ fontSize: '1rem', fontWeight: '700', color: market.outcome ? '#22c55e' : '#ef4444', marginBottom: '0.25rem' }}>
        Resolved: {market.outcome ? 'YES' : 'NO'}
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--color-fg-dim)' }}>
        Winners can claim payouts from the dashboard.
      </div>
    </div>
  ) : market.status === 2 ? (
    <div style={{
      background: 'var(--color-bg)', border: '1px solid var(--color-border-subtle)',
      borderRadius: '10px', padding: '1.25rem', textAlign: 'center',
    }}>
      <div style={{ fontSize: '1rem', fontWeight: '700', color: '#ef4444', marginBottom: '0.25rem' }}>
        Market Cancelled
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--color-fg-dim)' }}>
        Participants can claim refunds from the dashboard.
      </div>
    </div>
  ) : null;

  /* ════════════════════════════════════════════════════════════
     LEFT COLUMN — Trade Panel (sticky on desktop,
                                pinned bottom on mobile)
     ════════════════════════════════════════════════════════════ */
  const leftColumn = (
    <div
      className="md-trade-panel"
      style={{
        ...(isMobile
          ? {
              position: 'fixed', bottom: 0, left: 0, right: 0,
              zIndex: 50,
              background: 'var(--color-surface)',
              borderTop: '1px solid var(--color-border-subtle)',
              padding: '1rem 1rem calc(1rem + env(safe-area-inset-bottom))',
              maxHeight: '55vh',
              overflowY: 'auto',
            }
          : {
              width: LEFT_COL_WIDTH, minWidth: LEFT_COL_WIDTH,
              position: 'sticky', top: '80px',
              alignSelf: 'flex-start',
              maxHeight: 'calc(100vh - 96px)',
              overflowY: 'auto',
            }
        ),
      }}
    >
      <div style={{
        ...(isMobile
          ? {}
          : {
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: '12px',
              padding: '1.25rem',
            }
        ),
      }}>
        {/* Section label */}
        <h2 style={{
          fontSize: '0.75rem', fontWeight: '600',
          textTransform: 'uppercase', letterSpacing: '0.1em',
          color: 'var(--color-fg-dim)', margin: '0 0 1rem',
        }}>
          Outcome Probabilities
        </h2>

        {outcomeProbabilities}

        {/* Divider */}
        <div style={{
          height: '1px', background: 'var(--color-border-subtle)',
          margin: '1rem 0',
        }} />

        {/* Trade form or status banner */}
        {tradeForm || statusBanner}

        {/* Admin controls — only visible to contract owner */}
        {isOwner && market.status === 0 && (
          <>
            <div style={{
              height: '1px', background: 'var(--color-border-subtle)',
              margin: '1rem 0',
            }} />
            <div style={{
              background: 'rgba(249, 115, 22, 0.06)',
              border: '1px solid rgba(249, 115, 22, 0.2)',
              borderRadius: '10px',
              padding: '1rem',
            }}>
              <div style={{
                fontSize: '0.625rem', fontWeight: '700',
                textTransform: 'uppercase', letterSpacing: '0.15em',
                color: 'var(--color-accent)', marginBottom: '0.75rem',
              }}>
                Admin Controls
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <button
                  onClick={() => setShowResolveModal({ outcome: true })}
                  style={{
                    padding: '0.625rem', fontSize: '0.6875rem', fontWeight: '700',
                    fontFamily: 'var(--font-body)',
                    background: '#22c55e', color: '#08090a',
                    border: 'none', borderRadius: '8px', cursor: 'pointer',
                    textTransform: 'uppercase',
                  }}
                >
                  Resolve YES
                </button>
                <button
                  onClick={() => setShowResolveModal({ outcome: false })}
                  style={{
                    padding: '0.625rem', fontSize: '0.6875rem', fontWeight: '700',
                    fontFamily: 'var(--font-body)',
                    background: '#ef4444', color: '#fff',
                    border: 'none', borderRadius: '8px', cursor: 'pointer',
                    textTransform: 'uppercase',
                  }}
                >
                  Resolve NO
                </button>
              </div>
              <button
                onClick={() => setShowCancelModal(true)}
                style={{
                  width: '100%',
                  padding: '0.625rem', fontSize: '0.6875rem', fontWeight: '700',
                  fontFamily: 'var(--font-body)',
                  background: 'var(--color-surface-elevated)',
                  color: 'var(--color-fg-muted)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px', cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                Cancel Market
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  /* ════════════════════════════════════════════════════════════
     RIGHT COLUMN — Market Info (scrollable)
     ════════════════════════════════════════════════════════════ */
  const rightColumn = (
    <div style={{ flex: 1, minWidth: 0 }}>

      {/* ─── MARKET HEADER ─── */}
      <section style={{
        position: 'relative',
        minHeight: isMobile ? '200px' : '240px',
        display: 'flex',
        alignItems: 'flex-end',
        overflow: 'hidden',
        borderRadius: isMobile ? 0 : '12px',
        marginBottom: '1.25rem',
      }}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'cover',
              filter: 'brightness(0.3) blur(2px)',
            }}
          />
        ) : (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
          }} />
        )}

        {/* Gradient fade */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to top, var(--color-bg) 0%, transparent 70%)',
        }} />

        <div style={{ position: 'relative', zIndex: 1, width: '100%', padding: '1.5rem' }}>
          {/* Back button */}
          <button
            onClick={() => navigate('/')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '8px', padding: '6px 14px',
              color: 'var(--color-fg)', fontSize: '0.75rem',
              fontFamily: 'var(--font-body)', cursor: 'pointer',
              marginBottom: '1rem', transition: 'all 0.15s ease',
            }}
          >
            &larr; Back
          </button>

          {/* Status + Category badges */}
          <div style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.375rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-block',
              padding: '3px 10px',
              fontSize: '0.625rem', fontWeight: '700',
              textTransform: 'uppercase', letterSpacing: '0.1em',
              background: STATUS_BG[market.status],
              color: STATUS_COLORS[market.status],
              borderRadius: '4px',
            }}>
              {STATUS_LABELS[market.status]}
            </span>
            {(() => {
              const cat = CATEGORIES[Number(market.category)] || CATEGORIES[5];
              return (
                <span style={{
                  display: 'inline-block',
                  padding: '3px 10px',
                  fontSize: '0.625rem', fontWeight: '700',
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                  background: cat.bg,
                  color: cat.color,
                  borderRadius: '4px',
                }}>
                  {cat.label}
                </span>
              );
            })()}
          </div>

          {/* Title */}
          <h1 style={{
            fontSize: 'clamp(1.25rem, 3vw, 2rem)',
            fontWeight: '700', color: 'var(--color-fg)',
            lineHeight: 1.3, margin: 0,
          }}>
            {title}
          </h1>
        </div>
      </section>

      {/* ─── STATS BAR ─── */}
      <section className="market-stats-grid" style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
        gap: '0.75rem',
        marginBottom: '1.25rem',
      }}>
        {[
          { label: 'Volume', value: formatVolume(market.totalVolume) },
          { label: 'Trades', value: market.totalTrades.toString() },
          {
            label: 'Created',
            value: chartData.length > 0
              ? new Date(chartData[0].time * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : '\u2014',
          },
          {
            label: 'Ends',
            value: new Date(Number(market.endTime) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          },
        ].map((stat) => (
          <div key={stat.label} style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: '10px',
            padding: '1rem',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: '0.625rem', color: 'var(--color-fg-dim)',
              textTransform: 'uppercase', letterSpacing: '0.1em',
              marginBottom: '0.375rem',
            }}>
              {stat.label}
            </div>
            <div style={{
              fontSize: '1.125rem', fontWeight: '700',
              color: 'var(--color-fg)',
            }}>
              {stat.value}
            </div>
          </div>
        ))}
      </section>

      {/* ─── COUNTDOWN TIMER ─── */}
      {market.status === 0 && (
        <section style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: '10px',
          padding: '1.25rem',
          textAlign: 'center',
          marginBottom: '1.25rem',
        }}>
          <div style={{
            fontSize: '0.625rem', color: 'var(--color-fg-dim)',
            textTransform: 'uppercase', letterSpacing: '0.15em',
            marginBottom: '0.75rem',
          }}>
            Time Remaining
          </div>

          {countdown.ended ? (
            <div style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--color-danger)' }}>
              Market Ended
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem' }}>
              {[
                { value: countdown.days, label: 'Days' },
                { value: countdown.hours, label: 'Hrs' },
                { value: countdown.minutes, label: 'Min' },
                { value: countdown.seconds, label: 'Sec' },
              ].map((unit) => (
                <div key={unit.label}>
                  <div style={{
                    fontSize: 'clamp(1.25rem, 3vw, 2rem)',
                    fontWeight: '700',
                    color: 'var(--color-fg)',
                    fontFamily: 'var(--font-body)',
                    lineHeight: 1,
                    minWidth: '48px',
                  }}>
                    {String(unit.value).padStart(2, '0')}
                  </div>
                  <div style={{
                    fontSize: '0.625rem',
                    color: 'var(--color-fg-dim)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginTop: '4px',
                  }}>
                    {unit.label}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ─── PRICE HISTORY CHART ─── */}
      <section style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: '10px',
        padding: '1.25rem',
        marginBottom: '1.25rem',
      }}>
        {/* Header + time filter tabs */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem',
        }}>
          <h2 style={{
            fontSize: '0.75rem', fontWeight: '600', margin: 0,
            textTransform: 'uppercase', letterSpacing: '0.1em',
            color: 'var(--color-fg)',
          }}>
            Price History
          </h2>

          <div style={{
            display: 'flex', gap: '3px',
            background: 'var(--color-bg)', borderRadius: '8px', padding: '3px',
          }}>
            {TIME_FILTERS.map((f) => (
              <button
                key={f.label}
                onClick={() => setTimeFilter(f.label)}
                style={{
                  padding: '5px 10px',
                  fontSize: '0.625rem', fontWeight: '600',
                  fontFamily: 'var(--font-body)',
                  background: timeFilter === f.label ? 'var(--color-surface-elevated)' : 'transparent',
                  color: timeFilter === f.label ? 'var(--color-fg)' : 'var(--color-fg-dim)',
                  border: 'none', borderRadius: '6px', cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '1.25rem', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '3px', background: '#22c55e', borderRadius: '2px', display: 'inline-block' }} />
            <span style={{ fontSize: '0.75rem', color: '#22c55e', fontWeight: '600' }}>Yes {yesPercent}%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '3px', background: '#ef4444', borderRadius: '2px', display: 'inline-block' }} />
            <span style={{ fontSize: '0.75rem', color: '#ef4444', fontWeight: '600' }}>No {noPercent}%</span>
          </div>
        </div>

        {/* Chart */}
        {chartLoading ? (
          <div style={{ height: '260px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{
              width: '24px', height: '24px',
              border: '3px solid var(--color-border)',
              borderTopColor: 'var(--color-accent)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }} />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={displayChartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
              <CartesianGrid stroke="var(--color-border-subtle)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="time"
                tickFormatter={(t) => {
                  const d = new Date(t * 1000);
                  if (['1H', '6H', '1D'].includes(timeFilter)) {
                    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  }
                  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
                }}
                tick={{ fontSize: 10, fill: '#71717a' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 10, fill: '#71717a' }}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip
                formatter={(value, name) => [`${value.toFixed(2)}%`, name === 'yes' ? 'Yes' : 'No']}
                labelFormatter={(label) => new Date(label * 1000).toLocaleString()}
                contentStyle={{
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  fontSize: '11px',
                  color: 'var(--color-fg)',
                }}
              />
              <Line type="monotone" dataKey="yes" stroke="#22c55e" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#22c55e' }} isAnimationActive={false} />
              <Line type="monotone" dataKey="no" stroke="#ef4444" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#ef4444' }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginTop: '0.75rem', paddingTop: '0.625rem',
          borderTop: '1px solid var(--color-border-subtle)',
        }}>
          <span style={{ fontSize: '0.625rem', color: 'var(--color-fg-dim)' }}>
            {tradeCount} trade{tradeCount !== 1 ? 's' : ''} recorded
          </span>
          <span style={{ fontSize: '0.625rem', color: 'var(--color-fg-dim)' }}>
            Powered by{' '}
            <a
              href="https://testnet.arcscan.app"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-accent)', textDecoration: 'none' }}
            >
              BlockScout
            </a>
          </span>
        </div>
      </section>

      {/* ─── ABOUT / RESOLUTION RULES ─── */}
      <section style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: '10px',
        padding: '1.25rem',
        marginBottom: isMobile ? '200px' : '2rem', // extra bottom space on mobile for pinned trade panel
      }}>
        <button
          onClick={() => setAboutExpanded(!aboutExpanded)}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            width: '100%', background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--color-fg)', padding: 0,
            fontFamily: 'var(--font-body)',
          }}
        >
          <span style={{
            fontSize: '0.75rem', fontWeight: '600',
            textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>
            About this Market
          </span>
          <span style={{
            fontSize: '1.125rem', color: 'var(--color-fg-dim)',
            transition: 'transform 0.2s ease',
            display: 'inline-block',
            transform: aboutExpanded ? 'rotate(45deg)' : 'rotate(0deg)',
          }}>
            +
          </span>
        </button>

        {aboutExpanded && (
          <div style={{
            marginTop: '0.875rem', paddingTop: '0.875rem',
            borderTop: '1px solid var(--color-border-subtle)',
            color: 'var(--color-fg-muted)', fontSize: '0.8125rem',
            lineHeight: 1.7, animation: 'fadeIn 0.2s ease',
          }}>
            <p style={{ margin: '0 0 0.5rem' }}>
              <strong style={{ color: 'var(--color-fg)' }}>Resolution Rules:</strong>
            </p>
            <p style={{ margin: '0 0 0.5rem' }}>
              This market resolves to <strong>YES</strong> if the event described in the
              market question occurs before the market end date. Otherwise, it resolves
              to <strong>NO</strong>.
            </p>
            <p style={{ margin: '0 0 0.5rem' }}>
              The market creator (admin) will resolve this market based on publicly
              verifiable information. Once resolved, winning participants can claim
              their payouts proportional to their position size.
            </p>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-fg-dim)' }}>
              Contract:{' '}
              <a
                href={`https://testnet.arcscan.app/address/${CONTRACT_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--color-accent)', textDecoration: 'none' }}
              >
                {CONTRACT_ADDRESS.slice(0, 6)}...{CONTRACT_ADDRESS.slice(-4)}
              </a>
            </p>
          </div>
        )}
      </section>
    </div>
  );

  /* ══════════════════════════ RENDER ══════════════════════════ */

  return (
    <main style={{ paddingTop: '72px', minHeight: '100vh', background: 'var(--color-bg)' }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: isMobile ? '0 1rem 0' : '1.5rem 1.5rem 2rem',
        display: isMobile ? 'block' : 'flex',
        gap: '1.5rem',
        alignItems: 'flex-start',
      }}>
        {isMobile ? (
          <>
            {/* Mobile: info first, trade panel pinned to bottom */}
            {rightColumn}
            {leftColumn}
          </>
        ) : (
          <>
            {/* Desktop: left sticky trade, right scrollable info */}
            {leftColumn}
            {rightColumn}
          </>
        )}
      </div>

      {/* Scrollbar override for trade panel on desktop */}
      <style>{`
        .md-trade-panel::-webkit-scrollbar {
          width: 4px;
        }
        .md-trade-panel::-webkit-scrollbar-thumb {
          background: var(--color-border);
          border-radius: 2px;
        }
      `}</style>

      {/* ── Resolve Confirmation Modal ── */}
      {showResolveModal && (
        <div
          role="dialog"
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={() => setShowResolveModal(null)}
        >
          <div
            style={{
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border)',
              borderRadius: '16px', padding: '2rem',
              width: '100%', maxWidth: '400px',
              animation: 'scaleIn 0.25s ease',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{
              fontSize: '1.25rem', fontWeight: '600',
              color: 'var(--color-fg)', marginBottom: '1rem',
            }}>
              Resolve Market
            </h2>
            <p style={{
              fontSize: '0.875rem', color: 'var(--color-fg-muted)',
              marginBottom: '1.5rem', lineHeight: 1.6,
            }}>
              Are you sure you want to resolve this market as{' '}
              <strong style={{
                color: showResolveModal.outcome ? '#22c55e' : '#ef4444',
              }}>
                {showResolveModal.outcome ? 'YES' : 'NO'}
              </strong>
              ? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                onClick={() => setShowResolveModal(null)}
                style={{
                  flex: 1, padding: '0.75rem', fontSize: '0.875rem', fontWeight: '600',
                  fontFamily: 'var(--font-body)',
                  background: 'var(--color-border)', color: 'var(--color-fg)',
                  border: 'none', borderRadius: '8px', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleResolveMarket(showResolveModal.outcome)}
                disabled={isResolving}
                style={{
                  flex: 1, padding: '0.75rem', fontSize: '0.875rem', fontWeight: '600',
                  fontFamily: 'var(--font-body)',
                  background: isResolving
                    ? 'var(--color-fg-dim)'
                    : showResolveModal.outcome ? '#22c55e' : '#ef4444',
                  color: showResolveModal.outcome ? '#08090a' : '#fff',
                  border: 'none', borderRadius: '8px',
                  cursor: isResolving ? 'not-allowed' : 'pointer',
                }}
              >
                {isResolving ? 'Resolving...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel Market Modal ── */}
      {showCancelModal && (
        <div
          role="dialog"
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={() => { setShowCancelModal(false); setCancelReason(''); }}
        >
          <div
            style={{
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border)',
              borderRadius: '16px', padding: '2rem',
              width: '100%', maxWidth: '400px',
              animation: 'scaleIn 0.25s ease',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{
              fontSize: '1.25rem', fontWeight: '600',
              color: 'var(--color-fg)', marginBottom: '1rem',
            }}>
              Cancel Market
            </h2>
            <p style={{
              fontSize: '0.875rem', color: 'var(--color-fg-muted)',
              marginBottom: '1rem', lineHeight: 1.6,
            }}>
              Are you sure you want to cancel this market? This action cannot be undone.
              All participants will be able to claim refunds.
            </p>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{
                display: 'block', fontSize: '0.75rem',
                color: 'var(--color-fg-muted)', textTransform: 'uppercase',
                letterSpacing: '0.1em', marginBottom: '0.5rem',
                fontFamily: 'var(--font-body)',
              }}>
                Reason
              </label>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Enter cancellation reason..."
                style={{
                  width: '100%', padding: '0.75rem', fontSize: '0.875rem',
                  fontFamily: 'var(--font-body)',
                  background: 'var(--color-bg)', color: 'var(--color-fg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px', boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                onClick={() => { setShowCancelModal(false); setCancelReason(''); }}
                style={{
                  flex: 1, padding: '0.75rem', fontSize: '0.875rem', fontWeight: '600',
                  fontFamily: 'var(--font-body)',
                  background: 'var(--color-border)', color: 'var(--color-fg)',
                  border: 'none', borderRadius: '8px', cursor: 'pointer',
                }}
              >
                Go Back
              </button>
              <button
                onClick={handleCancelMarket}
                disabled={isCancelling || !cancelReason.trim()}
                style={{
                  flex: 1, padding: '0.75rem', fontSize: '0.875rem', fontWeight: '600',
                  fontFamily: 'var(--font-body)',
                  background: isCancelling || !cancelReason.trim()
                    ? 'var(--color-fg-dim)' : '#ef4444',
                  color: '#fff',
                  border: 'none', borderRadius: '8px',
                  cursor: isCancelling || !cancelReason.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {isCancelling ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
