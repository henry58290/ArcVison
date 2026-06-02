import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useBalance } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { CONTRACT_ADDRESS, CONTRACT_ABI } from '../components/utils/contracts';
import { fetchMarketLogs, calculateProbabilityTimeSeries, calculateActivity } from '../components/utils/logParser';
import { clearCache } from '../components/utils/indexedDb';
import { useNotification } from '../components/NotificationProvider';
import { appendBet } from '../components/profile/mockBets';
import { MarketGlyph, getCardGradient } from '../components/utils/marketGlyphs';
import MarketChart from '../components/market/MarketChart';
import ActivityFeed from '../components/market/ActivityFeed';
import '../components/market/marketDetail.css';

/* ────────────────────────── constants ────────────────────────── */

const IMAGE_SEPARATOR = '||';
const STATUS_LABELS = { 0: 'Active', 1: 'Resolved', 2: 'Cancelled' };
const STATUS_VARIANT = { 0: 'active', 1: 'resolved', 2: 'cancelled' };

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

const EXPLORER_URL = 'https://testnet.arcscan.app';

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

const pad2 = (x) => String(x).padStart(2, '0');

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

/* ══════════════════════════ COMPONENT ══════════════════════════ */

export default function MarketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const marketId = Number(id);
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

  const [tradeMode, setTradeMode] = useState('buy'); // 'buy' | 'sell'
  const [amount, setAmount] = useState('');
  const [sellAmount, setSellAmount] = useState('');
  const [selectedSide, setSelectedSide] = useState(true); // default to Yes
  const [imgError, setImgError] = useState(false);
  const [infoTab, setInfoTab] = useState('res'); // 'res' | 'act'

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

  const {
    writeContract: sellWriteContract,
    isPending: isSellPending,
    error: sellError,
    isSuccess: sellSubmitted,
    data: sellHash,
  } = useWriteContract();

  /* ── user position for sell ── */
  const { data: userYesBet, refetch: refetchYesBet } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'yesBets',
    args: [BigInt(marketId), address],
    query: { enabled: !isNaN(marketId) && !!address },
  });

  const { data: userNoBet, refetch: refetchNoBet } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'noBets',
    args: [BigInt(marketId), address],
    query: { enabled: !isNaN(marketId) && !!address },
  });

  /* ── sell quote ── */
  const sellAmountWei = useMemo(() => {
    try {
      if (!sellAmount || parseFloat(sellAmount) <= 0) return 0n;
      return parseEther(sellAmount);
    } catch { return 0n; }
  }, [sellAmount]);

  const { data: sellQuote } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getSellQuote',
    args: [BigInt(marketId), selectedSide, sellAmountWei],
    query: {
      enabled: !isNaN(marketId) && sellAmountWei > 0n && tradeMode === 'sell',
    },
  });

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
  const { isSuccess: sellConfirmed } = useWaitForTransactionReceipt({ hash: sellHash });
  const { isSuccess: resolveConfirmed } = useWaitForTransactionReceipt({ hash: resolveHash });
  const { isSuccess: cancelConfirmed } = useWaitForTransactionReceipt({ hash: cancelHash });

  /* ── chart state ── */

  const [chartData, setChartData] = useState([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState('All');
  const [tradeCount, setTradeCount] = useState(0);
  const [activity, setActivity] = useState([]);
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
      setActivity(calculateActivity(logs, marketId));
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

  /* ── derived data ── */

  const { title, imageUrl, subcategory } = useMemo(
    () => parseMarketTitle(market?.question),
    [market?.question],
  );

  const yesPercent = odds
    ? Number(odds[0]) / 100
    : market?.yesOdds
      ? Number(market.yesOdds) / 100
      : 50;
  const noPercent = 100 - yesPercent;
  const yesPercentDisplay = yesPercent.toFixed(2);
  const noPercentDisplay = noPercent.toFixed(2);

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

  const handleSell = () => {
    try {
      if (!sellAmount || parseFloat(sellAmount) <= 0) return;
      const amountWei = parseEther(sellAmount);
      sellWriteContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'sellPosition',
        args: [BigInt(marketId), selectedSide, amountWei],
      });
    } catch (err) {
      console.error(err);
    }
  };

  /* ── unified refresh after confirmed tx ── */

  const refreshAllData = useCallback(async () => {
    await clearCache(marketId);
    refetchOdds();
    refetchMarket();
    loadChartData(true);
  }, [marketId, refetchMarket, refetchOdds, loadChartData]);

  // Dedupe trade-history persistence by tx hash so the effect can't append twice
  // for the same confirmed tx.
  const recordedTxRef = useRef(new Set());

  // After trade is confirmed on-chain
  useEffect(() => {
    if (tradeConfirmed) {
      const side = selectedSide ? 'Yes' : 'No';
      const amt = amount.trim() || '0.01';
      addNotification(`Buy ${side} — ${amt} USDC`, tradeHash);
      refreshAllData();
      refetchYesBet();
      refetchNoBet();

      // Persist to local trade history (Profile page reads this).
      if (tradeHash && !recordedTxRef.current.has(tradeHash)) {
        recordedTxRef.current.add(tradeHash);
        appendBet({
          id: tradeHash,
          market: title || market?.question || `Market #${marketId}`,
          position: selectedSide ? 'YES' : 'NO',
          wagered: parseFloat(amt) || 0,
          status: 'Active',
          outcome: null,
          pnl: 0,
          date: new Date().toISOString().slice(0, 10),
          txHash: tradeHash,
        });
      }
    }
  }, [tradeConfirmed, refreshAllData]);

  // After sell is confirmed on-chain
  useEffect(() => {
    if (sellConfirmed) {
      const side = selectedSide ? 'Yes' : 'No';
      addNotification(`Sold ${side} — ${sellAmount} shares`, sellHash);
      refreshAllData();
      refetchYesBet();
      refetchNoBet();
      setSellAmount('');
    }
  }, [sellConfirmed, refreshAllData]);

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

  /* ── loading / error states ── */

  if (marketLoading) {
    return (
      <main className="md-page page--with-bottom-nav" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="md-spin" />
      </main>
    );
  }

  if (!market) {
    return (
      <main className="md-page page--with-bottom-nav" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
        <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-fg)' }}>Market not found</div>
        <button className="md-cta" style={{ width: 'auto', padding: '12px 24px' }} onClick={() => navigate('/')}>
          Back to Markets
        </button>
      </main>
    );
  }

  /* ── display-derived values ── */

  const isActive = market.status === 0;
  const statusVariant = STATUS_VARIANT[market.status] || 'active';
  const cat = CATEGORIES[Number(market.category)] || CATEGORIES[5];
  const gradient = getCardGradient(market.category, subcategory);
  const hasImage = Boolean(imageUrl) && !imgError;
  const liquidity = formatVolume((market.totalYes || 0n) + (market.totalNo || 0n));
  const countdownStr = countdown.ended
    ? 'Ended'
    : `${countdown.days}d ${pad2(countdown.hours)}h ${pad2(countdown.minutes)}m ${pad2(countdown.seconds)}s`;
  const endDateShort = new Date(Number(market.endTime) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const endDateLong = new Date(Number(market.endTime) * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const createdStr = chartData.length > 0
    ? new Date(chartData[0].time * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  // Order-summary math (all contract-driven)
  const stakeNum = parseFloat(amount) || 0;
  const balNum = walletBalance ? parseFloat(formatEther(walletBalance.value)) : 0;
  const payoutNum = estimatedPayout ? parseFloat(formatEther(estimatedPayout)) : 0;
  const retPct = stakeNum > 0 && payoutNum > 0 ? (payoutNum / stakeNum - 1) * 100 : 0;
  const overBalance = stakeNum > balNum;
  const sideCol = selectedSide ? 'var(--color-yes)' : 'var(--color-no)';

  const sideBal = selectedSide ? userYesBet : userNoBet;
  const sideBalNum = sideBal ? parseFloat(formatEther(sideBal)) : 0;

  /* ════════════════════ ORDER TICKET BODY ════════════════════ */

  const ticketBody = isActive ? (
    !isConnected ? (
      <div className="md-connect">
        <div className="md-connect__t">Connect wallet to trade</div>
        <div className="md-connect__s">You need a connected wallet to place positions.</div>
        <ConnectButton />
      </div>
    ) : (
      <>
        {/* Buy / Sell tabs */}
        <div className="md-tk__tabs">
          <button className={`md-tk__tab ${tradeMode === 'buy' ? 'on' : ''}`} onClick={() => setTradeMode('buy')}>Buy</button>
          <button className={`md-tk__tab ${tradeMode === 'sell' ? 'on' : ''}`} onClick={() => setTradeMode('sell')}>Sell</button>
        </div>

        {/* Yes / No outcome chips */}
        <div className="md-tk__out">
          <button className={`md-ob md-ob--y ${selectedSide ? 'on' : ''}`} onClick={() => setSelectedSide(true)}>
            <div className="md-ob__l">Yes</div>
            <div className="md-ob__p">{yesPercentDisplay}¢</div>
          </button>
          <button className={`md-ob md-ob--n ${!selectedSide ? 'on' : ''}`} onClick={() => setSelectedSide(false)}>
            <div className="md-ob__l">No</div>
            <div className="md-ob__p">{noPercentDisplay}¢</div>
          </button>
        </div>

        {/* ══════ BUY ══════ */}
        {tradeMode === 'buy' && (
          <>
            <div className="md-flab">
              <span>Amount</span>
              <span className="bal">Balance <b>${balNum.toFixed(2)}</b></span>
            </div>
            <div className="md-amt">
              <span className="cur">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="md-quick">
              {[{ label: '25%', mult: 0.25 }, { label: '50%', mult: 0.5 }, { label: 'Max', mult: 1 }].map(({ label, mult }) => (
                <button
                  key={label}
                  onClick={() => {
                    if (walletBalance) {
                      const bal = parseFloat(formatEther(walletBalance.value));
                      const maxAmt = Math.max(0, bal - 0.001);
                      setAmount((maxAmt * mult).toFixed(4));
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="md-summary">
              <div className="md-srow"><span>Avg price</span><b>{selectedSide ? yesPercentDisplay : noPercentDisplay}¢</b></div>
              <div className="md-srow"><span>Your stake</span><b>${stakeNum.toFixed(2)}</b></div>
              <div className="md-win">
                <span className="md-win__l">If {selectedSide ? 'Yes' : 'No'} wins</span>
                <span>
                  <span className="md-win__pay" style={{ color: sideCol }}>${payoutNum.toFixed(2)}</span>
                  <span className="md-win__ret" style={{ color: sideCol }}>{retPct >= 0 ? '+' : ''}{retPct.toFixed(0)}%</span>
                </span>
              </div>
            </div>

            <button
              className={`md-cta ${selectedSide ? '' : 'md-cta--no'}`}
              onClick={() => handleTrade(selectedSide)}
              disabled={isTradePending || stakeNum <= 0 || overBalance}
            >
              {isTradePending
                ? (<><span className="md-cta__spin" />Confirming…</>)
                : overBalance ? 'Insufficient balance'
                  : stakeNum > 0 ? `Buy ${selectedSide ? 'Yes' : 'No'}` : 'Enter an amount'}
            </button>

            <div className="md-tnote">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.6-3 7.7-7 9-4-1.3-7-4.4-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
              Settled in USDC · resolves {endDateShort}
            </div>

            {tradeError && <div className="md-tmsg md-tmsg--err">{tradeError.message.slice(0, 80)}</div>}
            {tradeSubmitted && !tradeConfirmed && (
              <div className="md-tmsg md-tmsg--wait"><span className="md-tmsg__spin" />Waiting for confirmation…</div>
            )}
            {tradeConfirmed && (
              <div className="md-tmsg md-tmsg--ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>Confirmed!</div>
            )}
          </>
        )}

        {/* ══════ SELL ══════ */}
        {tradeMode === 'sell' && (
          <>
            <div className="md-pos">
              <span>Your {selectedSide ? 'Yes' : 'No'} shares</span>
              <b>{sideBalNum.toFixed(4)}</b>
            </div>

            {sideBalNum <= 0 ? (
              <div className="md-sell-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /></svg>
                <div>You hold no {selectedSide ? 'Yes' : 'No'} shares.<br />Buy to open a position first.</div>
              </div>
            ) : (
              <>
                <div className="md-flab"><span>Shares</span></div>
                <div className="md-amt">
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    placeholder="0"
                    inputMode="decimal"
                    value={sellAmount}
                    onChange={(e) => setSellAmount(e.target.value)}
                  />
                </div>
                <div className="md-quick">
                  {[{ label: '25%', pct: 25 }, { label: '50%', pct: 50 }, { label: 'Max', pct: 100 }].map(({ label, pct }) => (
                    <button
                      key={label}
                      onClick={() => {
                        const bal = selectedSide ? userYesBet : userNoBet;
                        if (bal) setSellAmount(formatEther((bal * BigInt(pct)) / 100n));
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {sellAmount && parseFloat(sellAmount) > 0 && sellQuote && (
                  <div className="md-summary">
                    <div className="md-srow"><span>Price</span><b>{(Number(sellQuote[3]) / 100).toFixed(1)}¢</b></div>
                    <div className="md-win">
                      <span className="md-win__l">You receive</span>
                      <span className="md-win__pay">${parseFloat(formatEther(sellQuote[2])).toFixed(4)}</span>
                    </div>
                  </div>
                )}

                <button
                  className={`md-cta ${selectedSide ? 'md-cta--no' : ''}`}
                  onClick={handleSell}
                  disabled={isSellPending || !sellAmount || parseFloat(sellAmount) <= 0 || (() => {
                    const bal = selectedSide ? userYesBet : userNoBet;
                    if (!bal) return true;
                    try { return parseEther(sellAmount) > bal; } catch { return true; }
                  })()}
                >
                  {isSellPending
                    ? (<><span className="md-cta__spin" />Confirming…</>)
                    : `Sell ${selectedSide ? 'Yes' : 'No'}`}
                </button>

                {sellError && <div className="md-tmsg md-tmsg--err">{sellError.message.slice(0, 80)}</div>}
                {sellSubmitted && !sellConfirmed && (
                  <div className="md-tmsg md-tmsg--wait"><span className="md-tmsg__spin" />Waiting for confirmation…</div>
                )}
                {sellConfirmed && (
                  <div className="md-tmsg md-tmsg--ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>Confirmed!</div>
                )}
              </>
            )}
          </>
        )}
      </>
    )
  ) : null;

  /* ── Resolved / Cancelled banner ── */
  const statusBanner = market.status === 1 ? (
    <div className="md-banner">
      <div className={`md-banner__t ${market.outcome ? 'yes' : 'no'}`}>Resolved: {market.outcome ? 'YES' : 'NO'}</div>
      <div className="md-banner__s">Winners can claim payouts from the dashboard.</div>
    </div>
  ) : market.status === 2 ? (
    <div className="md-banner">
      <div className="md-banner__t no">Market Cancelled</div>
      <div className="md-banner__s">Participants can claim refunds from the dashboard.</div>
    </div>
  ) : null;

  /* ════════════════════ MAIN CONTENT (chart + tabs) ════════════════════ */

  const mainCol = (
    <div className="md-left">
      <MarketChart
        data={displayChartData}
        range={timeFilter}
        ranges={TIME_FILTERS.map((f) => f.label)}
        onRangeChange={setTimeFilter}
        loading={chartLoading}
        tradeCount={tradeCount}
        explorerUrl={EXPLORER_URL}
      />

      <section className="md-card md-rise md-d3">
        <div className="md-tabs">
          <button className={`md-tab ${infoTab === 'res' ? 'on' : ''}`} onClick={() => setInfoTab('res')}>Resolution</button>
          <button className={`md-tab ${infoTab === 'act' ? 'on' : ''}`} onClick={() => setInfoTab('act')}>Activity</button>
        </div>
        <div className="md-tabbody">
          {infoTab === 'res' ? (
            <>
              <div className="md-res-text">
                This market resolves <b className="yes">Yes</b> if the event described in the question
                occurs before {endDateLong}. It resolves <b className="no">No</b> otherwise.
                {createdStr ? ` Created ${createdStr}.` : ''}
              </div>
              <div className="md-res">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.6-3 7.7-7 9-4-1.3-7-4.4-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
                <div>
                  <b>Resolution source.</b> Resolved on-chain by the market admin from publicly
                  verifiable information; winners claim payouts proportional to their position.
                  {' '}Contract{' '}
                  <a href={`${EXPLORER_URL}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noopener noreferrer">
                    {CONTRACT_ADDRESS.slice(0, 6)}…{CONTRACT_ADDRESS.slice(-4)}
                  </a>.
                </div>
              </div>
            </>
          ) : (
            <ActivityFeed items={activity} />
          )}
        </div>
      </section>
    </div>
  );

  /* ════════════════════ ORDER TICKET (sticky right) ════════════════════ */

  const ticket = (
    <aside className="md-right">
      <div className="md-card md-tk md-rise md-d2">
        {isActive && (
          <div className="md-tk__bar">
            <div className="md-tk__bar-price">{yesPercentDisplay}¢ <span className="lead">Yes</span></div>
            <span className="md-live"><span className="md-live__dot" />Live</span>
          </div>
        )}

        {ticketBody || statusBanner}

        {isOwner && isActive && (
          <div className="md-admin">
            <div className="md-admin__title">Admin Controls</div>
            <div className="md-admin__grid">
              <button className="md-admin__btn md-admin__btn--yes" onClick={() => setShowResolveModal({ outcome: true })}>Resolve YES</button>
              <button className="md-admin__btn md-admin__btn--no" onClick={() => setShowResolveModal({ outcome: false })}>Resolve NO</button>
            </div>
            <button className="md-admin__btn md-admin__btn--cancel" onClick={() => setShowCancelModal(true)}>Cancel Market</button>
          </div>
        )}
      </div>
    </aside>
  );

  /* ══════════════════════════ RENDER ══════════════════════════ */

  return (
    <main className="md-page page--with-bottom-nav">
      <div className="md-wrap">
        {/* Breadcrumb */}
        <div className="md-crumb">
          <a onClick={() => navigate('/')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
            Markets
          </a>
          <span>/</span>
          <span>{cat.label}</span>
        </div>

        {/* Text-forward header */}
        <div className="md-head md-rise md-d1">
          <div className="md-head__thumb" style={hasImage ? undefined : { background: gradient }}>
            {hasImage ? (
              <img src={imageUrl} alt="" onError={() => setImgError(true)} />
            ) : (
              <MarketGlyph categoryId={market.category} subcategory={subcategory} size={32} />
            )}
          </div>
          <div className="md-head__body">
            <div className="md-chips">
              <span className={`md-chip md-chip--${statusVariant}`}>
                {statusVariant === 'active' && <span className="md-chip__dot" />}
                {STATUS_LABELS[market.status]}
              </span>
              <span className="md-chip md-chip--cat">{cat.label}</span>
              {subcategory && <span className="md-chip md-chip--reg">{subcategory}</span>}
            </div>
            <h1 className="md-q">{title}</h1>
          </div>
        </div>

        {/* Inline meta row */}
        <div className="md-meta md-rise md-d1">
          <span className="md-meta__item"><b>{formatVolume(market.totalVolume)}</b> volume</span>
          <span className="md-meta__sep" />
          <span className="md-meta__item"><b>{liquidity}</b> liquidity</span>
          <span className="md-meta__sep" />
          <span className="md-meta__item"><b>{market.totalTrades.toString()}</b> trades</span>
          <span className="md-meta__sep" />
          <span className="md-meta__item md-meta__end">
            {isActive ? <>Ends in <b>{countdownStr}</b></> : <>Ended <b>{endDateShort}</b></>}
          </span>
        </div>

        {/* Detail grid */}
        <div className="md-grid">
          {mainCol}
          {ticket}
        </div>
      </div>

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
