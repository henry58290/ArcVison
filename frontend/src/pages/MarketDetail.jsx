import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useBalance } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
} from 'recharts';
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../components/utils/contracts';
import { fetchMarketLogs, calculateProbabilityTimeSeries } from '../components/utils/logParser';
import { clearCache } from '../components/utils/indexedDb';
import { useNotification } from '../components/NotificationProvider';

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

function parseTitle(raw) {
  const parts = raw.split(':::');
  if (parts.length === 2) return { title: parts[0].trim(), subcategory: parts[1].trim() };
  return { title: raw, subcategory: null };
}

function parseMarketTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return { title: '', imageUrl: null, subcategory: null };
  const imgParts = rawTitle.split(IMAGE_SEPARATOR);
  const imageUrl = imgParts.length >= 2 && imgParts[1].trim() ? imgParts[1].trim() : null;
  const titleRaw = imgParts[0].trim();
  const { title, subcategory } = parseTitle(titleRaw);
  return { title, imageUrl, subcategory };
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
  const { addNotification } = useNotification();

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
  const [selectedSide, setSelectedSide] = useState(true); // default to Yes
  const [showUsdMode, setShowUsdMode] = useState(true); // toggle USD/token display

  /* ── wallet balance ── */
  const { data: walletBalance } = useBalance({
    address,
    query: { enabled: !!address && isConnected },
  });
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
    args: [BigInt(marketId), selectedSide, amount ? parseEther(amount) : 0n],
    query: {
      enabled: !isNaN(marketId) && !!amount && parseFloat(amount) > 0,
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

  const { title, imageUrl, subcategory } = useMemo(
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
    const now = Math.floor(Date.now() / 1000);

    if (filteredChartData.length > 0) {
      // Append a live "now" point so the chart extends to the current moment
      // and reflects the latest on-chain odds immediately after a trade.
      const liveYes = odds
        ? parseFloat((Number(odds[0]) / 100).toFixed(2))
        : yesPercent;
      const liveNo = parseFloat((100 - liveYes).toFixed(2));
      const lastPoint = filteredChartData[filteredChartData.length - 1];

      if (now > lastPoint.time) {
        return [
          ...filteredChartData,
          { time: now, yes: liveYes, no: liveNo, timeStr: '' },
        ];
      }
      return filteredChartData;
    }

    if (!chartLoading && yesPercent != null) {
      return [
        { time: now - 3600, yes: yesPercent, no: noPercent, timeStr: '' },
        { time: now, yes: yesPercent, no: noPercent, timeStr: '' },
      ];
    }
    return [];
  }, [filteredChartData, chartLoading, yesPercent, noPercent, odds]);

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

  const handleQuickFill = (val) => {
    const current = parseFloat(amount) || 0;
    setAmount((current + val).toString());
  };

  const handleMaxFill = () => {
    if (walletBalance) {
      const bal = parseFloat(formatEther(walletBalance.value));
      // Leave a small buffer for gas
      const maxAmount = Math.max(0, bal - 0.001);
      setAmount(maxAmount > 0 ? maxAmount.toFixed(4) : '0');
    }
  };

  /* ── unified refresh after confirmed tx ── */

  const refreshAllData = useCallback(async () => {
    await clearCache(marketId);
    refetchOdds();
    refetchMarket();
    loadChartData(true);
  }, [marketId, refetchMarket, refetchOdds, loadChartData]);

  // After trade is confirmed on-chain
  useEffect(() => {
    if (tradeConfirmed) {
      const side = selectedSide ? 'Yes' : 'No';
      const amt = amount.trim() || '0.01';
      addNotification(`Buy ${side} — ${amt} USDC`, tradeHash);
      refreshAllData();
    }
  }, [tradeConfirmed, refreshAllData]);

  // After resolve is confirmed on-chain
  useEffect(() => {
    if (resolveConfirmed) {
      addNotification('Market Resolved', resolveHash);
      refreshAllData();
      setShowResolveModal(null);
    }
  }, [resolveConfirmed, refreshAllData]);

  // After cancel is confirmed on-chain
  useEffect(() => {
    if (cancelConfirmed) {
      addNotification('Market Cancelled', cancelHash);
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
            background: 'var(--color-accent)', color: 'var(--color-accent-fg)',
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

  /* ── Outcome Probabilities (single split bar) ── */
  const outcomeProbabilities = (
    <div style={{ marginBottom: '1.25rem' }}>
      {/* Single split probability bar */}
      <div style={{
        height: '10px', borderRadius: '5px', overflow: 'hidden',
        display: 'flex', marginBottom: '0.625rem',
      }}>
        <div style={{
          width: `${yesPercent}%`, background: 'var(--color-success)',
          transition: 'width 0.5s ease',
          borderRadius: yesPercent >= 100 ? '5px' : '5px 0 0 5px',
        }} />
        <div style={{
          width: `${noPercent}%`, background: 'var(--color-danger)',
          transition: 'width 0.5s ease',
          borderRadius: noPercent >= 100 ? '5px' : '0 5px 5px 0',
        }} />
      </div>
      {/* Dot labels below the bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: 'var(--color-success)', display: 'inline-block', flexShrink: 0,
          }} />
          <span style={{ fontSize: '0.8125rem', fontWeight: '600', color: 'var(--color-fg)' }}>
            Yes {yesPercent}%
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: 'var(--color-danger)', display: 'inline-block', flexShrink: 0,
          }} />
          <span style={{ fontSize: '0.8125rem', fontWeight: '600', color: 'var(--color-fg)' }}>
            No {noPercent}%
          </span>
        </div>
      </div>
    </div>
  );

  /* ── Trade Form (the interactive part) ── */
  const tradeForm = market.status === 0 ? (
    !isConnected ? (
      <div style={{ textAlign: 'center', padding: '1.25rem 0' }}>
        <div style={{
          width: '48px', height: '48px', borderRadius: '50%',
          background: 'var(--color-accent-muted)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem',
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
        </div>
        <div style={{ fontSize: '0.9375rem', fontWeight: '600', color: 'var(--color-fg)', marginBottom: '0.375rem' }}>
          Connect wallet to trade
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--color-fg-dim)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
          You need a connected wallet to place positions on this market.
        </div>
        <ConnectButton />
      </div>
    ) : (
      <>
        {/* ── Outcome Selector (segmented tab control) ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0',
          background: 'var(--color-bg)', borderRadius: '10px', padding: '3px',
          marginBottom: '1rem',
        }}>
          <button
            onClick={() => setSelectedSide(true)}
            className="trade-outcome-tab"
            style={{
              padding: '0.75rem 0.5rem', fontSize: '0.875rem', fontWeight: '700',
              fontFamily: 'var(--font-body)',
              background: selectedSide === true ? 'var(--color-success)' : 'transparent',
              color: selectedSide === true ? '#fff' : 'var(--color-fg-dim)',
              border: 'none', borderRadius: '8px', cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: '0.04em',
              transition: 'all 0.15s ease',
              position: 'relative',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            }}
          >
            YES
            <span style={{
              fontSize: '0.75rem', fontWeight: '600',
              opacity: selectedSide === true ? 0.85 : 0.6,
            }}>
              {yesPercent}¢
            </span>
            {selectedSide === true && (
              <span style={{
                position: 'absolute', bottom: '0', left: '50%',
                transform: 'translateX(-50%)', width: '28px', height: '2.5px',
                background: '#fff', borderRadius: '2px', opacity: 0.6,
              }} />
            )}
          </button>
          <button
            onClick={() => setSelectedSide(false)}
            className="trade-outcome-tab"
            style={{
              padding: '0.75rem 0.5rem', fontSize: '0.875rem', fontWeight: '700',
              fontFamily: 'var(--font-body)',
              background: selectedSide === false ? 'var(--color-danger)' : 'transparent',
              color: selectedSide === false ? '#fff' : 'var(--color-fg-dim)',
              border: 'none', borderRadius: '8px', cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: '0.04em',
              transition: 'all 0.15s ease',
              position: 'relative',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            }}
          >
            NO
            <span style={{
              fontSize: '0.75rem', fontWeight: '600',
              opacity: selectedSide === false ? 0.85 : 0.6,
            }}>
              {noPercent}¢
            </span>
            {selectedSide === false && (
              <span style={{
                position: 'absolute', bottom: '0', left: '50%',
                transform: 'translateX(-50%)', width: '28px', height: '2.5px',
                background: '#fff', borderRadius: '2px', opacity: 0.6,
              }} />
            )}
          </button>
        </div>

        {/* ── Amount Section ── */}
        <div style={{ marginBottom: '1rem' }}>
          {/* Amount header row */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '0.5rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <label style={{
                fontSize: '0.625rem',
                color: 'var(--color-fg-dim)', textTransform: 'uppercase',
                letterSpacing: '0.12em',
                fontFamily: 'var(--font-body)', fontWeight: '600',
                margin: 0,
              }}>
                Amount
              </label>
              <button
                onClick={() => setShowUsdMode(!showUsdMode)}
                title="Toggle USD / Token"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-accent)', fontSize: '0.875rem',
                  padding: '2px', display: 'flex', alignItems: 'center',
                  transition: 'color 0.15s ease',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 16V4m0 0L3 8m4-4l4 4"/>
                  <path d="M17 8v12m0 0l4-4m-4 4l-4-4"/>
                </svg>
              </button>
            </div>
            {/* Wallet balance */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.375rem',
              fontSize: '0.6875rem', color: 'var(--color-fg-dim)',
              fontFamily: 'var(--font-body)',
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="M22 10H18a2 2 0 0 0 0 4h4"/>
              </svg>
              <span>
                ${walletBalance ? parseFloat(formatEther(walletBalance.value)).toFixed(2) : '0.00'}
              </span>
            </div>
          </div>

          {/* Amount input container */}
          <div className="trade-amount-input-wrap" style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: '10px',
            padding: '0.75rem',
            transition: 'border-color 0.15s ease',
            marginBottom: '0.5rem',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center',
            }}>
              <span style={{
                fontSize: '1.5rem', fontWeight: '700', color: 'var(--color-fg-dim)',
                marginRight: '2px', fontFamily: 'var(--font-body)',
                userSelect: 'none',
              }}>$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="trade-amount-input"
                style={{
                  flex: 1,
                  fontSize: '1.5rem', fontWeight: '700',
                  fontFamily: 'var(--font-body)',
                  background: 'transparent',
                  color: 'var(--color-fg)',
                  border: 'none', outline: 'none',
                  padding: 0, margin: 0,
                  minWidth: 0,
                }}
              />
              <span style={{
                fontSize: '0.75rem', fontWeight: '600',
                color: 'var(--color-fg-dim)',
                background: 'var(--color-surface-elevated)',
                padding: '0.25rem 0.5rem',
                borderRadius: '6px',
                flexShrink: 0,
                fontFamily: 'var(--font-body)',
                letterSpacing: '0.04em',
              }}>
                {showUsdMode ? 'USD' : 'ETH'}
              </span>
            </div>
          </div>

          {/* Quick-fill buttons */}
          <div className="trade-quickfill" style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.375rem',
          }}>
            {[1, 10, 100].map((val) => (
              <button
                key={val}
                onClick={() => handleQuickFill(val)}
                className="trade-quickfill-btn"
                style={{
                  padding: '0.5rem 0.25rem',
                  fontSize: '0.6875rem', fontWeight: '600',
                  fontFamily: 'var(--font-body)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-fg-muted)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px', cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  textAlign: 'center',
                }}
              >
                +${val}
              </button>
            ))}
            <button
              onClick={handleMaxFill}
              className="trade-quickfill-btn trade-quickfill-max"
              style={{
                padding: '0.5rem 0.25rem',
                fontSize: '0.6875rem', fontWeight: '700',
                fontFamily: 'var(--font-body)',
                background: 'var(--color-accent-muted)',
                color: 'var(--color-accent)',
                border: '1px solid transparent',
                borderRadius: '8px', cursor: 'pointer',
                transition: 'all 0.15s ease',
                textAlign: 'center',
                letterSpacing: '0.06em',
              }}
            >
              MAX
            </button>
          </div>
        </div>

        {/* ── Order Summary ── */}
        <div className="trade-returns" style={{
          background: 'var(--color-bg)',
          borderRadius: '10px', padding: '0.875rem',
          marginBottom: '1rem',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '0.5rem',
          }}>
            <span style={{ fontSize: '0.6875rem', color: 'var(--color-fg-dim)', fontWeight: '500' }}>
              Avg Price
            </span>
            <span style={{ fontSize: '0.8125rem', fontWeight: '600', color: 'var(--color-fg)' }}>
              {selectedSide ? yesPercent : noPercent}¢
            </span>
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '0.5rem',
          }}>
            <span style={{ fontSize: '0.6875rem', color: 'var(--color-fg-dim)', fontWeight: '500' }}>
              Shares
            </span>
            <span style={{ fontSize: '0.8125rem', fontWeight: '600', color: 'var(--color-fg)' }}>
              {amount && parseFloat(amount) > 0
                ? (parseFloat(amount) / ((selectedSide ? yesPercent : noPercent) / 100)).toFixed(2)
                : '0.00'}
            </span>
          </div>
          <div style={{
            height: '1px', background: 'var(--color-border-subtle)', margin: '0.5rem 0',
          }} />
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: '0.6875rem', color: 'var(--color-fg-dim)', fontWeight: '500' }}>
              Potential Return
            </span>
            <span style={{ fontSize: '0.875rem', fontWeight: '700', color: 'var(--color-success)' }}>
              {amount && parseFloat(amount) > 0 ? (
                <>
                  ${payoutDisplay}
                  {estimatedPayout && (
                    <span style={{ fontSize: '0.6875rem', marginLeft: '4px' }}>
                      ({((parseFloat(payoutDisplay) / parseFloat(amount) - 1) * 100).toFixed(0)}%)
                    </span>
                  )}
                </>
              ) : '--'}
            </span>
          </div>
        </div>

        {/* ── Trade Action Button ── */}
        <button
          onClick={() => handleTrade(selectedSide)}
          disabled={isTradePending || !amount || parseFloat(amount) <= 0}
          className="trade-action-btn"
          style={{
            width: '100%',
            padding: '1rem', fontSize: '0.875rem', fontWeight: '700',
            fontFamily: 'var(--font-body)',
            background: isTradePending
              ? 'var(--color-fg-dim)'
              : (selectedSide ? 'var(--color-success)' : 'var(--color-danger)'),
            color: isTradePending ? 'var(--color-bg)' : '#fff',
            border: 'none',
            borderRadius: '12px', cursor: isTradePending ? 'not-allowed' : 'pointer',
            textTransform: 'uppercase', letterSpacing: '0.06em',
            transition: 'all 0.2s ease',
            marginBottom: '0.75rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
          }}
        >
          {isTradePending ? (
            <>
              <span style={{
                width: '16px', height: '16px',
                border: '2px solid currentColor',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                display: 'inline-block',
              }} />
              Confirming...
            </>
          ) : (
            <>
              BUY {selectedSide ? 'YES' : 'NO'}
              {amount && parseFloat(amount) > 0 ? ` \u2014 $${parseFloat(amount).toFixed(0)}` : ''}
            </>
          )}
        </button>

        {/* Error */}
        {tradeError && (
          <div style={{
            background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger)',
            borderRadius: '8px', padding: '0.75rem', marginBottom: '0.75rem',
          }}>
            <div style={{ fontSize: '0.6875rem', color: 'var(--color-danger)', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px' }}>
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
            background: 'var(--color-accent-muted)', border: '1px solid var(--color-accent)',
            borderRadius: '8px', padding: '0.75rem', marginBottom: '0.75rem',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            <span style={{
              width: '14px', height: '14px',
              border: '2px solid var(--color-accent)',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              display: 'inline-block', flexShrink: 0,
            }} />
            <div style={{ fontSize: '0.75rem', color: 'var(--color-accent)', fontWeight: '600' }}>
              Transaction submitted, waiting for confirmation...
            </div>
          </div>
        )}
        {tradeConfirmed && (
          <div style={{
            background: 'var(--color-success-bg)', border: '1px solid var(--color-success)',
            borderRadius: '8px', padding: '0.75rem', marginBottom: '0.75rem',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-success)', fontWeight: '600' }}>
              Transaction confirmed on-chain!
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <p style={{
          fontSize: '0.5625rem', color: 'var(--color-fg-dim)',
          textAlign: 'center', lineHeight: 1.5, margin: 0,
        }}>
          By trading you agree to the smart-contract terms.
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
      <div style={{ fontSize: '1rem', fontWeight: '700', color: market.outcome ? 'var(--color-success)' : 'var(--color-danger)', marginBottom: '0.25rem' }}>
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
      <div style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--color-danger)', marginBottom: '0.25rem' }}>
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
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: '16px',
              padding: '1.25rem',
              marginBottom: '2rem',
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
              borderRadius: '16px',
              padding: '1.25rem',
            }
        ),
      }}>
        {/* Trade Panel Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: '1rem',
        }}>
          <h2 style={{
            fontSize: '1rem', fontWeight: '700',
            color: 'var(--color-fg)', margin: 0,
            fontFamily: 'var(--font-body)',
          }}>
            Trade
          </h2>
          {market.status === 0 && (
            <span className="trade-live-badge" style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              fontSize: '0.625rem', fontWeight: '700',
              color: 'var(--color-success)',
              background: 'var(--color-success-bg)',
              padding: '0.25rem 0.625rem',
              borderRadius: '999px',
              fontFamily: 'var(--font-body)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
              <span className="trade-live-dot" style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: 'var(--color-success)',
                display: 'inline-block',
              }} />
              LIVE
            </span>
          )}
        </div>

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
              background: 'var(--color-accent-muted)',
              border: '1px solid var(--color-accent)',
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
                    background: 'var(--color-success)', color: 'var(--color-accent-fg)',
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
                    background: 'var(--color-danger)', color: '#fff',
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
            background: 'linear-gradient(135deg, var(--color-hero-1) 0%, var(--color-hero-2) 50%, var(--color-hero-3) 100%)',
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

          {/* Subcategory Badge */}
          {subcategory && (
            <span style={{
              display: 'inline-block',
              padding: '0.25rem 0.6rem',
              background: 'rgba(139,92,246,0.15)',
              color: '#8b5cf6',
              fontSize: '0.6875rem',
              fontWeight: '600',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              borderRadius: '4px',
              marginTop: '0.5rem',
            }}>
              {subcategory}
            </span>
          )}
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
            <span style={{ width: '12px', height: '3px', background: 'var(--color-success)', borderRadius: '2px', display: 'inline-block' }} />
            <span style={{ fontSize: '0.75rem', color: 'var(--color-success)', fontWeight: '600' }}>Yes {yesPercent}%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '3px', background: 'var(--color-danger)', borderRadius: '2px', display: 'inline-block' }} />
            <span style={{ fontSize: '0.75rem', color: 'var(--color-danger)', fontWeight: '600' }}>No {noPercent}%</span>
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
                tick={{ fontSize: 10, fill: 'var(--color-fg-dim)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 10, fill: 'var(--color-fg-dim)' }}
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
              <Line type="monotone" dataKey="yes" stroke="var(--color-success)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: 'var(--color-success)' }} isAnimationActive={false} />
              <Line type="monotone" dataKey="no" stroke="var(--color-danger)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: 'var(--color-danger)' }} isAnimationActive={false} />
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
        marginBottom: '2rem',
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

      {/* Scrollbar styles handled by CSS */}

      {/* ── Resolve Confirmation Modal ── */}
      {showResolveModal && (
        <div
          role="dialog"
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'var(--color-overlay)', backdropFilter: 'blur(4px)',
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
                color: showResolveModal.outcome ? 'var(--color-success)' : 'var(--color-danger)',
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
                    : showResolveModal.outcome ? 'var(--color-success)' : 'var(--color-danger)',
                  color: showResolveModal.outcome ? 'var(--color-accent-fg)' : '#fff',
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
            background: 'var(--color-overlay)', backdropFilter: 'blur(4px)',
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
                    ? 'var(--color-fg-dim)' : 'var(--color-danger)',
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
