import { useState, useEffect, useMemo, useCallback } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useSearchParams, useNavigate } from "react-router-dom";
import { parseEther, formatEther } from "viem";
import ProbabilityChart from "../components/ProbabilityChart";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "../components/utils/contracts";
import { clearCache } from "../components/utils/indexedDb";

const MarketStatus = { 0: "Open", 1: "Resolved", 2: "Cancelled" };
const IMAGE_SEPARATOR = "||";
const DEFAULT_PLACEHOLDER = "https://placehold.co/600x400/1a1a2e/666666?text=No+Image";
const DEFAULT_MARKET_DURATION_DAYS = 30;
const MAX_MARKET_DURATION_DAYS = 365;

function formatDateTimeLocalValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function getDateTimeInputValue(offsetMs = 0) {
  const date = new Date(Date.now() + offsetMs);
  date.setSeconds(0, 0);
  return formatDateTimeLocalValue(date);
}

function getDefaultExpirationDateTime() {
  return getDateTimeInputValue(DEFAULT_MARKET_DURATION_DAYS * 24 * 60 * 60 * 1000);
}

function buildNewMarketState() {
  return {
    question: "",
    expirationDateTime: getDefaultExpirationDateTime(),
    imageUrl: "",
    category: "0",
    subcategory: "",
  };
}

function getExpirationTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor(parsed.getTime() / 1000);
}

function parseTitle(raw) {
  const parts = raw.split(":::");
  if (parts.length === 2) return { title: parts[0].trim(), subcategory: parts[1].trim() };
  return { title: raw, subcategory: null };
}

function parseMarketTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== "string") {
    return { title: "", imageUrl: null, subcategory: null };
  }
  const imgParts = rawTitle.split(IMAGE_SEPARATOR);
  const imageUrl = imgParts.length >= 2 && imgParts[1].trim() ? imgParts[1].trim() : null;
  const titleRaw = imgParts[0].trim();
  const { title, subcategory } = parseTitle(titleRaw);
  return { title, imageUrl, subcategory };
}

function formatTimeLeft(endTime) {
  const now = Math.floor(Date.now() / 1000);
  const diff = endTime - now;
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days > 0) return `${days} day${days > 1 ? "s" : ""}`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""}`;
  return `${Math.floor(diff / 60)} min`;
}

function formatVolume(vol) {
  if (!vol || vol === 0n) return "$0";
  const eth = parseFloat(formatEther(vol));
  if (eth >= 1000000) return `$${(eth / 1000000).toFixed(1)}M`;
  if (eth >= 1000) return `$${(eth / 1000).toFixed(1)}K`;
  return `$${eth.toFixed(2)}`;
}

const CATEGORIES = [
  { id: 0, label: 'Crypto', color: '#f7931a', bg: 'rgba(247,147,26,0.15)' },
  { id: 1, label: 'Sports', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  { id: 2, label: 'Politics', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  { id: 3, label: 'Entertainment', color: '#a855f7', bg: 'rgba(168,85,247,0.15)' },
  { id: 4, label: 'Science', color: '#06b6d4', bg: 'rgba(6,182,212,0.15)' },
  { id: 5, label: 'Other', color: '#71717a', bg: 'rgba(113,113,122,0.15)' },
];

function RefundButton({ marketId, userAddress }) {
  const { writeContract: claimRefundWrite, isPending: isClaimingRefund } = useWriteContract();
  
  const { data: refundData, refetch: refetchRefund } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getRefundAmount",
    args: [BigInt(marketId), userAddress],
    query: {
      enabled: !!marketId && !!userAddress,
    }
  });

  const refundAmount = refundData?.[2] || 0n;
  const alreadyClaimed = refundData?.[3] || false;
  const isEligible = refundAmount > 0n && !alreadyClaimed;

  const handleClaimRefund = () => {
    claimRefundWrite({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: "claimRefund",
      args: [BigInt(marketId)],
    });
  };

  if (!isEligible) {
    return null;
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <button
        onClick={(e) => { e.stopPropagation(); handleClaimRefund(); }}
        disabled={isClaimingRefund}
        style={{
          padding: '0.5rem 1rem',
          fontSize: '0.6875rem',
          fontWeight: '600',
          background: isClaimingRefund ? 'var(--color-fg-dim)' : 'var(--color-accent)',
          color: 'var(--color-accent-fg)',
          border: 'none',
          borderRadius: '4px',
          cursor: isClaimingRefund ? 'not-allowed' : 'pointer',
          textTransform: 'uppercase',
        }}
      >
        {isClaimingRefund ? 'Claiming...' : `Claim ${formatVolume(refundAmount)} Refund`}
      </button>
    </div>
  );
}

function ClaimWinningsButton({ marketId, userAddress, refreshKey, onClaimed }) {
  const { writeContract: claimWinningsWrite, isPending: isClaimingWinnings } = useWriteContract();
  
  const { data: marketData, refetch: refetchMarket } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getMarketSummary",
    args: [BigInt(marketId)],
    query: { enabled: !!marketId }
  });

  const { data: yesBet, refetch: refetchYesBet } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "yesBets",
    args: [BigInt(marketId), userAddress],
    query: { enabled: !!userAddress && !!marketId }
  });

  const { data: noBet, refetch: refetchNoBet } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "noBets",
    args: [BigInt(marketId), userAddress],
    query: { enabled: !!userAddress && !!marketId }
  });

  const { data: hasClaimed, refetch: refetchClaimed } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "claimed",
    args: [BigInt(marketId), userAddress],
    query: { enabled: !!userAddress && !!marketId }
  });

  useEffect(() => {
    refetchMarket();
    refetchYesBet();
    refetchNoBet();
    refetchClaimed();
  }, [refreshKey, marketId]);

  const marketStatus = marketData?.status;
  const marketOutcome = marketData?.outcome;
  const yesAmount = yesBet || 0n;
  const noAmount = noBet || 0n;
  const alreadyClaimed = hasClaimed || false;

  const isResolved = marketStatus === 1;
  const winningAmount = marketOutcome ? yesAmount : noAmount;
  const isEligible = isResolved && winningAmount > 0n && !alreadyClaimed;

  const handleClaimWinnings = () => {
    claimWinningsWrite({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: "claimWinnings",
      args: [BigInt(marketId)],
    });
  };

  useEffect(() => {
    if (onClaimed) {
      onClaimed(marketId, hasClaimed);
    }
    // onClaimed intentionally excluded: it's a stable callback, including it
    // would cause an infinite update loop if the parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasClaimed, marketId]);

  if (alreadyClaimed) {
    return (
      <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
        <span style={{
          padding: '0.5rem 1rem',
          fontSize: '0.6875rem',
          fontWeight: '600',
          background: 'var(--color-success)',
          color: 'var(--color-accent-fg)',
          border: 'none',
          borderRadius: '4px',
          display: 'inline-block',
        }}>
          Claimed ✓
        </span>
      </div>
    );
  }

  if (!isEligible) {
    return null;
  }

  return (
    <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
      <button
        onClick={(e) => { e.stopPropagation(); handleClaimWinnings(); }}
        disabled={isClaimingWinnings}
        style={{
          padding: '0.5rem 1rem',
          fontSize: '0.6875rem',
          fontWeight: '600',
          background: isClaimingWinnings ? 'var(--color-fg-dim)' : 'var(--color-success)',
          color: 'var(--color-accent-fg)',
          border: 'none',
          borderRadius: '4px',
          cursor: isClaimingWinnings ? 'not-allowed' : 'pointer',
          textTransform: 'uppercase',
        }}
      >
        {isClaimingWinnings ? 'Claiming...' : `Claim ${formatVolume(winningAmount)} Winnings`}
      </button>
    </div>
  );
}

function SimpleClaimButton({ marketId, estimatedPayout, onSuccess }) {
  const { writeContract, isPending } = useWriteContract();

  const handleClaim = () => {
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: "claimWinnings",
      args: [BigInt(marketId)],
    });
  };

  return (
    <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
      <button
        onClick={handleClaim}
        disabled={isPending}
        style={{
          padding: '0.5rem 1rem',
          fontSize: '0.6875rem',
          fontWeight: '600',
          background: isPending ? 'var(--color-fg-dim)' : 'var(--color-success)',
          color: 'var(--color-accent-fg)',
          border: 'none',
          borderRadius: '4px',
          cursor: isPending ? 'not-allowed' : 'pointer',
          textTransform: 'uppercase',
        }}
      >
        {isPending ? 'Claiming...' : `Claim ${formatVolume(estimatedPayout)} Winnings`}
      </button>
    </div>
  );
}

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(null);
  const [showCancelModal, setShowCancelModal] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [newMarket, setNewMarket] = useState(() => buildNewMarketState());
  const [refreshKey, setRefreshKey] = useState(0);
  const [chartRefreshKey, setChartRefreshKey] = useState(0);
  const [marketCache, setMarketCache] = useState({});
  const [activeTab, setActiveTab] = useState("open");
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  const [searchParams, setSearchParams] = useSearchParams();
  
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab && ["open", "resolved", "cancelled", "claims"].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);
  const [userClaimedMarkets, setUserClaimedMarkets] = useState({});
  
  const { data: owner } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "owner",
  });

  const { data: globalStats } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getGlobalStats",
  });

  const { data: userPendingRefunds, refetch: refetchUserRefunds } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getUserPendingRefunds",
    args: [address],
    query: { enabled: !!address && isConnected }
  });

  const { data: userAllClaimInfo, refetch: refetchUserAllClaimInfo } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getUserAllClaimInfo",
    args: [address],
    query: { enabled: !!address && isConnected }
  });

  const { data: marketsData, refetch: refetchMarkets } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getMarkets",
    args: [0n, 50n],
  });

  const [cancelledMarketInfo, setCancelledMarketInfo] = useState({});

  const { data: cancelledInfoData, refetch: refetchCancelledInfo } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getCancelledMarkets",
  });

  useEffect(() => {
    if (cancelledInfoData && Array.isArray(cancelledInfoData)) {
      const infoMap = {};
      cancelledInfoData.forEach(info => {
        infoMap[info.marketId] = {
          totalYesAtCancel: info.totalYesAtCancel,
          totalNoAtCancel: info.totalNoAtCancel,
          totalTradesAtCancel: info.totalTradesAtCancel,
          reason: info.reason,
          cancelledAt: info.cancelledAt,
          question: info.question,
        };
      });
      setCancelledMarketInfo(infoMap);
    }
  }, [cancelledInfoData]);

  const { writeContract: createMarketWrite, isPending: isCreating } = useWriteContract();
  const { writeContract: resolveMarketWrite, isPending: isResolving } = useWriteContract();
  const { writeContract: cancelMarketWrite, isPending: isCancelling } = useWriteContract();
  const { writeContract: claimRefundWrite, isPending: isClaimingRefund } = useWriteContract();
  const { writeContract: claimWinningsWrite, isPending: isClaimingWinnings } = useWriteContract();

  const { isConfirmed: createConfirmed } = useWaitForTransactionReceipt({
    hash: createMarketWrite?.hash,
  });

  const { isConfirmed: resolveConfirmed } = useWaitForTransactionReceipt({
    hash: resolveMarketWrite?.hash,
  });

  const { isConfirmed: cancelConfirmed } = useWaitForTransactionReceipt({
    hash: cancelMarketWrite?.hash,
  });

  const { isConfirmed: refundConfirmed } = useWaitForTransactionReceipt({
    hash: claimRefundWrite?.hash,
  });

  const { isConfirmed: winningsConfirmed } = useWaitForTransactionReceipt({
    hash: claimWinningsWrite?.hash,
  });

  const { data: singleMarketData, refetch: refetchSingleMarket } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getMarketSummary",
    args: [showResolveModal ? BigInt(showResolveModal.marketId) : 0n],
    query: {
      enabled: !!showResolveModal?.marketId,
    }
  });

  useEffect(() => {
    if (createConfirmed || resolveConfirmed || cancelConfirmed || refundConfirmed || winningsConfirmed) {
      setMarketCache({});
      refetchMarkets();
      refetchCancelledInfo();
      refetchUserRefunds();
      refetchUserAllClaimInfo();
      setRefreshKey(k => k + 1);
      setChartRefreshKey(k => k + 1);
      
      const clearAllCaches = async () => {
        const marketsToClear = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        for (const id of marketsToClear) {
          await clearCache(id);
        }
      };
      clearAllCaches();
      
      setShowCreateModal(false);
      setShowResolveModal(null);
      setShowCancelModal(null);
      setCancelReason("");
      setNewMarket(buildNewMarketState());
    }
  }, [createConfirmed, resolveConfirmed, cancelConfirmed, refundConfirmed, winningsConfirmed]);

  useEffect(() => {
    if (resolveConfirmed && showResolveModal?.marketId) {
      const marketId = BigInt(showResolveModal.marketId);
      refetchSingleMarket();
    }
  }, [resolveConfirmed]);

  useEffect(() => {
    if (resolveConfirmed) {
      refetchSingleMarket();
    }
  }, [resolveConfirmed]);

  useEffect(() => {
    if (singleMarketData && showResolveModal?.marketId) {
      setMarketCache(prev => ({
        ...prev,
        [BigInt(showResolveModal.marketId)]: singleMarketData
      }));
    }
  }, [singleMarketData, showResolveModal?.marketId]);

  useEffect(() => {
    if (resolveConfirmed && marketsData?.[0]) {
      setMarketCache({});
    }
  }, [resolveConfirmed, marketsData]);

  const handleCloseCreateModal = () => {
    setShowCreateModal(false);
    setNewMarket(buildNewMarketState());
  };

  const isOwner = owner && address && owner.toLowerCase() === address.toLowerCase();
  const rawMarkets = marketsData?.[0] || [];
  const totalMarkets = marketsData?.[1] || 0n;
  
  const markets = rawMarkets.map(m => {
    if (marketCache[m.marketId]) {
      return marketCache[m.marketId];
    }
    return m;
  });
  const selectedExpirationTimestamp = getExpirationTimestamp(newMarket.expirationDateTime);
  const minExpirationDateTime = getDateTimeInputValue(60 * 1000);
  const maxExpirationDateTime = getDateTimeInputValue(MAX_MARKET_DURATION_DAYS * 24 * 60 * 60 * 1000);
  const nowTimestamp = Math.floor(Date.now() / 1000);
  const maxExpirationTimestamp = nowTimestamp + (MAX_MARKET_DURATION_DAYS * 24 * 60 * 60);
  const expirationInPast = selectedExpirationTimestamp !== null && selectedExpirationTimestamp <= nowTimestamp;
  const expirationTooFar = selectedExpirationTimestamp !== null && selectedExpirationTimestamp > maxExpirationTimestamp;
  const isCreateMarketFormValid = Boolean(newMarket.question.trim())
    && selectedExpirationTimestamp !== null
    && !expirationInPast
    && !expirationTooFar;

  const handleCreateMarket = (e) => {
    e.preventDefault();
    if (!isCreateMarketFormValid) return;
    const questionWithSub = newMarket.subcategory && newMarket.subcategory.trim()
      ? `${newMarket.question.trim()}:::${newMarket.subcategory.trim()}`
      : newMarket.question.trim();
    const encodedTitle = newMarket.imageUrl && newMarket.imageUrl.trim()
      ? `${questionWithSub}${IMAGE_SEPARATOR}${newMarket.imageUrl.trim()}`
      : questionWithSub;
    createMarketWrite({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: "createMarket",
      args: [encodedTitle, BigInt(selectedExpirationTimestamp), Number(newMarket.category)],
    });
  };

  const handleResolveMarket = (marketId, outcome) => {
    resolveMarketWrite({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: "resolveMarket",
      args: [BigInt(marketId), outcome],
    });
  };

  const handleCancelMarket = (marketId) => {
    if (!cancelReason.trim()) return;
    cancelMarketWrite({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: "cancelMarket",
      args: [BigInt(marketId), cancelReason],
    });
  };

  const handleClaimRefund = (marketId) => {
    claimRefundWrite({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: "claimRefund",
      args: [BigInt(marketId)],
    });
  };

  const totalVolume = globalStats?.[3] || 0n;
  const totalTrades = globalStats?.[4] || 0n;

  const pendingRefunds = useMemo(() => {
    if (!userPendingRefunds || !Array.isArray(userPendingRefunds)) return [];
    return userPendingRefunds.map(r => ({
      marketId: r.marketId,
      question: r.question,
      reason: r.reason,
      cancelledAt: r.cancelledAt,
      yesRefund: r.yesRefund || 0n,
      noRefund: r.noRefund || 0n,
      total: r.total || 0n,
    }));
  }, [userPendingRefunds]);

  const eligibleClaims = useMemo(() => {
    if (!userAllClaimInfo || !Array.isArray(userAllClaimInfo)) return [];
    return userAllClaimInfo.filter(c => c.isEligible);
  }, [userAllClaimInfo]);

  const claimedRewards = useMemo(() => {
    if (!userAllClaimInfo || !Array.isArray(userAllClaimInfo)) return [];
    return userAllClaimInfo.filter(c => c.hasClaimed);
  }, [userAllClaimInfo]);

  const handleClaimedChange = useCallback((marketId, claimed) => {
    setUserClaimedMarkets(prev => ({
      ...prev,
      [marketId]: claimed
    }));
  }, []);

  const availableSubcategories = useMemo(() => {
    if (selectedCategory === null) return [];
    if (activeTab === 'claims' || activeTab === 'cancelled') return [];
    let categoryMarkets;
    if (activeTab === 'open') categoryMarkets = markets.filter(m => m.status === 0 && Number(m.category) === selectedCategory);
    else if (activeTab === 'resolved') categoryMarkets = markets.filter(m => m.status === 1 && Number(m.category) === selectedCategory);
    else categoryMarkets = markets.filter(m => Number(m.category) === selectedCategory);
    const subs = new Set();
    categoryMarkets.forEach(m => {
      const { subcategory } = parseMarketTitle(m.question);
      if (subcategory) subs.add(subcategory);
    });
    return Array.from(subs).sort();
  }, [markets, activeTab, selectedCategory]);

  const subcategoryCounts = useMemo(() => {
    if (selectedCategory === null) return {};
    if (activeTab === 'claims' || activeTab === 'cancelled') return {};
    let categoryMarkets;
    if (activeTab === 'open') categoryMarkets = markets.filter(m => m.status === 0 && Number(m.category) === selectedCategory);
    else if (activeTab === 'resolved') categoryMarkets = markets.filter(m => m.status === 1 && Number(m.category) === selectedCategory);
    else categoryMarkets = markets.filter(m => Number(m.category) === selectedCategory);
    const counts = {};
    categoryMarkets.forEach(m => {
      const { subcategory } = parseMarketTitle(m.question);
      if (subcategory) {
        counts[subcategory] = (counts[subcategory] || 0) + 1;
      }
    });
    return counts;
  }, [markets, activeTab, selectedCategory]);

  const filteredMarkets = useMemo(() => {
    if (activeTab === 'claims' || activeTab === 'cancelled') return [];
    let result;
    if (activeTab === 'open') result = markets.filter(m => m.status === 0);
    else if (activeTab === 'resolved') result = markets.filter(m => m.status === 1);
    else result = markets;
    if (selectedCategory !== null) {
      result = result.filter(m => Number(m.category) === selectedCategory);
    }
    if (selectedSubcategory !== null) {
      result = result.filter(m => {
        const { subcategory } = parseMarketTitle(m.question);
        return subcategory === selectedSubcategory;
      });
    }
    return result;
  }, [markets, activeTab, selectedCategory, selectedSubcategory]);

  return (
    <main style={{ paddingTop: '100px', paddingBottom: '80px', minHeight: '100vh' }}>
      {/* Hero Section */}
      <section style={{ width: '100%', margin: '0 0 3rem', padding: '0 1rem' }}>
        {/* Admin Controls */}
        {isOwner && (
          <div style={{ 
            marginTop: '1.5rem', 
            padding: '1rem', 
            background: 'var(--color-accent-muted)', 
            border: '1px solid var(--color-accent)', 
            borderRadius: '8px' 
          }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-accent)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>
              Admin Controls
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => setShowCreateModal(true)}
                style={{
                  padding: '0.5rem 1rem',
                  fontSize: '0.75rem',
                  fontWeight: '600',
                  background: 'var(--color-accent)',
                  color: 'var(--color-accent-fg)',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                + Create Market
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Markets Section */}
      <section id="markets" style={{ width: '100%', margin: 0, padding: '0 1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h2 style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: '1.75rem', color: 'var(--color-fg)', letterSpacing: '0.02em' }}>
            MARKETS
          </h2>
          <div style={{
            display: 'flex', gap: '0.5rem',
            overflowX: 'auto', WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none', msOverflowStyle: 'none',
            paddingBottom: '2px',
          }}>
            {[
              { id: 'open', label: 'Open', count: markets.filter(m => m.status === 0).length },
              { id: 'resolved', label: 'Resolved', count: markets.filter(m => m.status === 1).length },
              { id: 'claims', label: 'My Claims', count: eligibleClaims.length, showBadge: eligibleClaims.length > 0 },
              { id: 'cancelled', label: 'My Refunds', count: pendingRefunds.length, showBadge: pendingRefunds.length > 0 },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setSearchParams({ tab: tab.id }); }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0.4rem 0.75rem',
                  background: activeTab === tab.id ? 'var(--color-accent-muted)' : 'transparent',
                  color: activeTab === tab.id ? 'var(--color-accent)' : 'var(--color-fg-muted)',
                  border: `1px solid ${activeTab === tab.id ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  fontSize: '0.75rem',
                  fontWeight: '600',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  position: 'relative',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span style={{
                    marginLeft: '6px',
                    padding: '2px 6px',
                    background: tab.showBadge ? 'var(--color-accent)' : 'var(--color-border)',
                    color: tab.showBadge ? 'var(--color-accent-fg)' : 'var(--color-fg-muted)',
                    borderRadius: '10px',
                    fontSize: '0.625rem',
                  }}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              onClick={() => setViewMode('grid')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.375rem',
                background: viewMode === 'grid' ? '#22c55e' : 'transparent',
                color: viewMode === 'grid' ? '#fff' : 'var(--color-fg-muted)',
                border: `1px solid ${viewMode === 'grid' ? '#22c55e' : 'var(--color-border)'}`,
                borderRadius: '4px',
                cursor: 'pointer',
              }}
              title="Grid view"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="1" width="6" height="6" rx="1" />
                <rect x="9" y="1" width="6" height="6" rx="1" />
                <rect x="1" y="9" width="6" height="6" rx="1" />
                <rect x="9" y="9" width="6" height="6" rx="1" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode('list')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.375rem',
                background: viewMode === 'list' ? '#22c55e' : 'transparent',
                color: viewMode === 'list' ? '#fff' : 'var(--color-fg-muted)',
                border: `1px solid ${viewMode === 'list' ? '#22c55e' : 'var(--color-border)'}`,
                borderRadius: '4px',
                cursor: 'pointer',
              }}
              title="List view"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="2" width="14" height="2" rx="1" />
                <rect x="1" y="7" width="14" height="2" rx="1" />
                <rect x="1" y="12" width="14" height="2" rx="1" />
              </svg>
            </button>
          </div>
        </div>

        {/* Category Filters — visible on Open / Resolved tabs */}
        {(activeTab === 'open' || activeTab === 'resolved') && (
          <>
          <div className="cat-chips">
            <button
              className={`cat-chip${selectedCategory === null ? ' cat-chip--active' : ''}`}
              onClick={() => { setSelectedCategory(null); setSelectedSubcategory(null); }}
            >
              All
            </button>
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                className={`cat-chip${selectedCategory === cat.id ? ' cat-chip--active' : ''}`}
                onClick={() => {
                  if (selectedCategory === cat.id) {
                    setSelectedCategory(null);
                  } else {
                    setSelectedCategory(cat.id);
                  }
                  setSelectedSubcategory(null);
                }}
                style={{ '--chip-color': cat.color }}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Subcategory Filters — chips visible on mobile only */}
          {selectedCategory !== null && availableSubcategories.length > 0 && (
            <div className="subcategory-chips--desktop-hidden" style={{
              display: 'flex', gap: '0.375rem', marginBottom: '1.5rem',
              overflowX: 'auto', WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none', msOverflowStyle: 'none',
              paddingBottom: '2px', flexWrap: 'wrap',
            }}>
              <button
                onClick={() => setSelectedSubcategory(null)}
                style={{
                  padding: '0.25rem 0.55rem',
                  fontSize: '0.625rem',
                  fontWeight: '600',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  border: `1px solid ${selectedSubcategory === null ? '#8b5cf6' : 'var(--color-border)'}`,
                  background: selectedSubcategory === null ? 'rgba(139,92,246,0.15)' : 'transparent',
                  color: selectedSubcategory === null ? '#8b5cf6' : 'var(--color-fg-muted)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                All
              </button>
              {availableSubcategories.map(sub => (
                <button
                  key={sub}
                  onClick={() => setSelectedSubcategory(selectedSubcategory === sub ? null : sub)}
                  style={{
                    padding: '0.25rem 0.55rem',
                    fontSize: '0.625rem',
                    fontWeight: '600',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    border: `1px solid ${selectedSubcategory === sub ? '#8b5cf6' : 'var(--color-border)'}`,
                    background: selectedSubcategory === sub ? 'rgba(139,92,246,0.15)' : 'transparent',
                    color: selectedSubcategory === sub ? '#8b5cf6' : 'var(--color-fg-muted)',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {sub}
                </button>
              ))}
            </div>
          )}
          </>
        )}

        <div className={`market-layout${!(activeTab === 'open' || activeTab === 'resolved') || selectedCategory === null || availableSubcategories.length === 0 ? ' market-layout--full' : ''}`}>
          {/* Sidebar — desktop only, visible when a category with subcategories is selected */}
          {(activeTab === 'open' || activeTab === 'resolved') && selectedCategory !== null && availableSubcategories.length > 0 && (
            <aside className="market-sidebar">
              <div className="sub-sidebar">
                <h4 className="sub-sidebar__title">Subcategories</h4>
                <button
                  className={`sub-row${selectedSubcategory === null ? ' sub-row--active' : ''}`}
                  onClick={() => setSelectedSubcategory(null)}
                >
                  <span>All</span>
                  <span className="sub-row__count">
                    {Object.values(subcategoryCounts).reduce((a, b) => a + b, 0)}
                  </span>
                </button>
                {availableSubcategories.map(sub => (
                  <button
                    key={sub}
                    className={`sub-row${selectedSubcategory === sub ? ' sub-row--active' : ''}`}
                    onClick={() => setSelectedSubcategory(selectedSubcategory === sub ? null : sub)}
                  >
                    <span className="sub-row__label">{sub}</span>
                    <span className="sub-row__count">{subcategoryCounts[sub] || 0}</span>
                  </button>
                ))}
              </div>
            </aside>
          )}

          <div className="market-main">

        {activeTab === 'claims' ? (
          <div>
            {!isConnected ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-fg-dim)' }}>
                Connect your wallet to view your claims.
              </div>
            ) : eligibleClaims.length === 0 && claimedRewards.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-fg-dim)' }}>
                You haven't participated in any resolved markets yet.
              </div>
            ) : (
              <div className="market-grid">
                {eligibleClaims.map((claim) => {
                  const { title, imageUrl, subcategory } = parseMarketTitle(claim.question);
                  const displayImageUrl = imageUrl || DEFAULT_PLACEHOLDER;
                  return (
                  <article
                    key={claim.marketId}
                    style={{ 
                      width: '100%',
                      minWidth: '0',
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: '12px',
                      padding: '16px',
                    }}
                  >
                    {imageUrl && (
                      <div style={{ marginBottom: '0.75rem', borderRadius: '8px', overflow: 'hidden' }}>
                        <img 
                          src={displayImageUrl} 
                          alt="" 
                          style={{ width: '100%', height: '140px', objectFit: 'cover' }}
                          onError={(e) => { e.target.src = DEFAULT_PLACEHOLDER; }}
                        />
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                      <span style={{
                        display: 'inline-flex',
                        padding: '0.25rem 0.5rem',
                        background: '#166534',
                        color: '#fff',
                        fontSize: '0.625rem',
                        fontWeight: '600',
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        borderRadius: '4px',
                      }}>
                        Unclaimed Winnings
                      </span>
                    </div>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: '600', color: 'var(--color-fg)', marginBottom: '0.5rem', lineHeight: 1.4 }}>
                      {title}
                    </h3>
                    {subcategory && (
                      <span style={{
                        display: 'inline-block',
                        padding: '0.2rem 0.5rem',
                        background: 'rgba(139,92,246,0.15)',
                        color: '#8b5cf6',
                        fontSize: '0.625rem',
                        fontWeight: '600',
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        borderRadius: '4px',
                        marginBottom: '0.5rem',
                      }}>
                        {subcategory}
                      </span>
                    )}
                    <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--color-success-bg)', borderRadius: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-success)' }}>Your Bet ({claim.outcome ? 'YES' : 'NO'}):</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-fg)', fontWeight: '600' }}>{formatVolume(claim.userWinningBet)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-fg-muted)' }}>Estimated Payout:</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-accent)', fontWeight: '600' }}>{formatVolume(claim.estimatedPayout)}</span>
                      </div>
                    </div>
                    <SimpleClaimButton 
                      marketId={claim.marketId} 
                      estimatedPayout={claim.estimatedPayout}
                    />
                  </article>
                  );})}
                {claimedRewards.map((claim) => {
                  const { title, imageUrl, subcategory } = parseMarketTitle(claim.question);
                  const displayImageUrl = imageUrl || DEFAULT_PLACEHOLDER;
                  return (
                  <article
                    key={`claimed-${claim.marketId}`}
                    style={{ 
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: '12px',
                      padding: '1.5rem',
                      opacity: 0.7,
                    }}
                  >
                    {imageUrl && (
                      <div style={{ marginBottom: '0.75rem', borderRadius: '8px', overflow: 'hidden' }}>
                        <img 
                          src={displayImageUrl} 
                          alt="" 
                          style={{ width: '100%', height: '140px', objectFit: 'cover' }}
                          onError={(e) => { e.target.src = DEFAULT_PLACEHOLDER; }}
                        />
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                      <span style={{
                        display: 'inline-flex',
                        padding: '0.25rem 0.5rem',
                        background: '#1e40af',
                        color: '#fff',
                        fontSize: '0.625rem',
                        fontWeight: '600',
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        borderRadius: '4px',
                      }}>
                        Claimed
                      </span>
                    </div>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: '600', color: 'var(--color-fg)', marginBottom: '0.5rem', lineHeight: 1.4 }}>
                      {title}
                    </h3>
                    {subcategory && (
                      <span style={{
                        display: 'inline-block',
                        padding: '0.2rem 0.5rem',
                        background: 'rgba(139,92,246,0.15)',
                        color: '#8b5cf6',
                        fontSize: '0.625rem',
                        fontWeight: '600',
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        borderRadius: '4px',
                        marginBottom: '0.5rem',
                      }}>
                        {subcategory}
                      </span>
                    )}
                    <div style={{ padding: '0.75rem', background: 'var(--color-success-bg)', borderRadius: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-fg-muted)' }}>Payout Claimed:</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-success)', fontWeight: '600' }}>{formatVolume(claim.estimatedPayout)}</span>
                      </div>
                    </div>
                  </article>
                  );})}
              </div>
            )}
          </div>
        ) : null}
        
        {activeTab === 'cancelled' ? (
          <div>
            {pendingRefunds.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-fg-dim)' }}>
                No pending refunds. You haven't been part of any cancelled markets.
              </div>
            ) : (
              <div className="market-grid">
                {pendingRefunds.map((refund) => {
                  const { title: refundTitle, subcategory: refundSubcategory } = parseMarketTitle(refund.question);
                  return (
                  <article
                    key={refund.marketId}
                    style={{ 
                      width: '100%',
                      minWidth: '0',
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: '12px',
                      padding: '16px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                      <span style={{
                        display: 'inline-flex',
                        padding: '0.25rem 0.5rem',
                        background: '#991b1b',
                        color: '#fff',
                        fontSize: '0.625rem',
                        fontWeight: '600',
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        borderRadius: '4px',
                      }}>
                        Cancelled
                      </span>
                    </div>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: '600', color: 'var(--color-fg)', marginBottom: '0.5rem', lineHeight: 1.4 }}>
                      {refundTitle}
                    </h3>
                    {refundSubcategory && (
                      <span style={{
                        display: 'inline-block',
                        padding: '0.2rem 0.5rem',
                        background: 'rgba(139,92,246,0.15)',
                        color: '#8b5cf6',
                        fontSize: '0.625rem',
                        fontWeight: '600',
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        borderRadius: '4px',
                        marginBottom: '0.5rem',
                      }}>
                        {refundSubcategory}
                      </span>
                    )}
                    {refund.reason && (
                      <div style={{ fontSize: '0.6875rem', color: 'var(--color-fg-muted)', marginBottom: '0.75rem' }}>
                        "{refund.reason}"
                      </div>
                    )}
                    <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--color-danger-bg)', borderRadius: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-success)' }}>YES Refund:</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-fg)', fontWeight: '600' }}>{formatVolume(refund.yesRefund)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-danger)' }}>NO Refund:</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-fg)', fontWeight: '600' }}>{formatVolume(refund.noRefund)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-fg-muted)' }}>Total:</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-accent)', fontWeight: '600' }}>{formatVolume(refund.total)}</span>
                      </div>
                    </div>
                    {isConnected && address && (
                      <RefundButton marketId={refund.marketId} userAddress={address} />
                    )}
                  </article>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
        
        {activeTab !== 'cancelled' && activeTab !== 'claims' && filteredMarkets.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-fg-dim)' }}>
            No {activeTab} markets available. {isOwner && activeTab === 'open' && "Create one to get started!"}
          </div>
        )}
        
        {activeTab !== 'cancelled' && activeTab !== 'claims' && filteredMarkets.length > 0 && viewMode === 'grid' && (
          <div className="market-grid">
            {filteredMarkets.map((market) => {
              const { title, imageUrl, subcategory } = parseMarketTitle(market.question);
              const yesPercent = market.yesOdds ? Math.round(Number(market.yesOdds) / 100) : 50;
              const noPercent = 100 - yesPercent;
              const displayImageUrl = imageUrl || DEFAULT_PLACEHOLDER;
              
              const yesPrice = market.yesOdds ? Math.round(Number(market.yesOdds) / 100) : 50;
              const noPrice = 100 - yesPrice;
              
              return (
                <article
                  key={`${market.marketId}-${refreshKey}`}
                  style={{ 
                    width: '100%',
                    minWidth: '0',
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: '12px',
                    padding: '16px',
                    cursor: 'pointer',
                    transition: 'all 0.25s ease',
                    opacity: market.status === 0 ? 1 : 0.7,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  }}
                  onClick={() => navigate(`/market/${market.marketId}`)}
                >
                  {/* Card Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{
                        display: 'inline-flex',
                        padding: '0.25rem 0.5rem',
                        background: market.status === 0 ? '#166534' : market.status === 1 ? '#1e40af' : '#991b1b',
                        color: '#fff',
                        fontSize: '0.625rem',
                        fontWeight: '600',
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        borderRadius: '4px',
                      }}>
                        {MarketStatus[market.status]}
                      </span>
                      {(() => {
                        const cat = CATEGORIES[Number(market.category)] || CATEGORIES[5];
                        return (
                          <span style={{
                            display: 'inline-flex',
                            padding: '0.25rem 0.5rem',
                            background: cat.bg,
                            color: cat.color,
                            fontSize: '0.625rem',
                            fontWeight: '600',
                            letterSpacing: '0.05em',
                            textTransform: 'uppercase',
                            borderRadius: '4px',
                          }}>
                            {cat.label}
                          </span>
                        );
                      })()}
                    </div>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--color-fg-dim)' }}>
                      {market.status === 0 ? `Ends in ${formatTimeLeft(Number(market.endTime))}` : `Ended`}
                    </span>
                  </div>

                  {/* Image */}
                  {imageUrl && (
                    <div style={{ marginBottom: '0.625rem', borderRadius: '6px', overflow: 'hidden' }}>
                      <img 
                        src={displayImageUrl} 
                        alt="" 
                        style={{ width: '100%', height: '112px', objectFit: 'cover' }}
                        onError={(e) => { e.target.src = DEFAULT_PLACEHOLDER; }}
                      />
                    </div>
                  )}

                  {/* Title */}
                  <h3 style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--color-fg)', marginBottom: '0.375rem', lineHeight: 1.35 }}>
                    {title}
                  </h3>

                  {/* Subcategory Badge */}
                  {subcategory && (
                    <span style={{
                      display: 'inline-block',
                      padding: '0.2rem 0.5rem',
                      background: 'rgba(139,92,246,0.15)',
                      color: '#8b5cf6',
                      fontSize: '0.625rem',
                      fontWeight: '600',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      borderRadius: '4px',
                      marginBottom: '0.625rem',
                    }}>
                      {subcategory}
                    </span>
                  )}

                  {/* Price Bar - YES/NO Split */}
                  {market.status === 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', marginBottom: '12px' }}>
                        <div style={{ width: `${yesPrice}%`, background: '#3b82f6', borderRadius: '4px 0 0 4px' }} />
                        <div style={{ width: `${noPrice}%`, background: '#ef4444', borderRadius: '0 4px 4px 0' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <span style={{ fontSize: '0.75rem', color: '#3b82f6', fontWeight: '600' }}>{yesPrice}%</span>
                        <span style={{ fontSize: '0.75rem', color: '#ef4444', fontWeight: '600' }}>{noPrice}%</span>
                      </div>
                      <div style={{ display: 'flex', gap: '12px' }}>
                        <span style={{ 
                          flex: 1, 
                          padding: '8px 12px', 
                          background: '#eff6ff', 
                          color: '#2563eb', 
                          borderRadius: '20px', 
                          fontSize: '0.8125rem', 
                          fontWeight: '600',
                          textAlign: 'center',
                        }}>
                          YES {yesPrice}¢
                        </span>
                        <span style={{ 
                          flex: 1, 
                          padding: '8px 12px', 
                          background: '#fef2f2', 
                          color: '#dc2626', 
                          borderRadius: '20px', 
                          fontSize: '0.8125rem', 
                          fontWeight: '600',
                          textAlign: 'center',
                        }}>
                          NO {noPrice}¢
                        </span>
                      </div>
                    </div>
                  )}
                  {market.status === 0 && (
                    <div style={{ marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-success)', fontWeight: '600' }}>YES {yesPercent}%</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-danger)', fontWeight: '600' }}>NO {noPercent}%</span>
                      </div>
                      <div style={{ height: '6px', background: 'var(--color-surface-elevated)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${yesPercent}%`, background: 'var(--color-success)', borderRadius: '4px', transition: 'width 0.4s ease' }} />
                      </div>
                    </div>
                  )}

                  {/* Resolution Result */}
                  {market.status === 1 && (
                    <div style={{ marginBottom: '0.75rem', padding: '0.45rem', background: market.outcome ? 'var(--color-success-bg)' : 'var(--color-danger-bg)', borderRadius: '4px', textAlign: 'center' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: '600', color: market.outcome ? 'var(--color-success)' : 'var(--color-danger)', textTransform: 'uppercase' }}>
                        Result: {market.outcome ? "YES" : "NO"}
                      </span>
                      {isConnected && address && (
                        <ClaimWinningsButton 
                          marketId={market.marketId} 
                          userAddress={address}
                          refreshKey={refreshKey}
                          onClaimed={handleClaimedChange}
                        />
                      )}
                    </div>
                  )}

                  {/* Cancelled Market - Claim Refund */}
                  {market.status === 2 && (() => {
                    const cancelledInfo = cancelledMarketInfo[market.marketId];
                    const volumeAtCancel = cancelledInfo 
                      ? cancelledInfo.totalYesAtCancel + cancelledInfo.totalNoAtCancel 
                      : 0n;
                    const tradesAtCancel = cancelledInfo?.totalTradesAtCancel || 0n;
                    
                    return (
                    <div style={{ marginBottom: '0.75rem', padding: '0.625rem', background: 'var(--color-danger-bg)', borderRadius: '4px' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--color-danger)', textTransform: 'uppercase', marginBottom: '0.5rem', textAlign: 'center' }}>
                        Market Cancelled
                      </div>
                      {cancelledInfo?.reason && (
                        <div style={{ fontSize: '0.6875rem', color: 'var(--color-fg-muted)', marginBottom: '0.5rem', textAlign: 'center' }}>
                          "{cancelledInfo.reason}"
                        </div>
                      )}
                      <div style={{ fontSize: '0.6875rem', color: 'var(--color-fg-muted)', marginBottom: '0.75rem', textAlign: 'center' }}>
                        Volume at cancel: {formatVolume(volumeAtCancel)}
                      </div>
                      {isConnected && address && (
                        <RefundButton marketId={market.marketId} userAddress={address} />
                      )}
                    </div>
                    );
                  })()}

                  {/* Footer */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid var(--color-border-subtle)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ display: 'flex' }}>
                        {[1,2,3].map(i => (
                          <div key={i} style={{ 
                            width: '24px', 
                            height: '24px', 
                            borderRadius: '50%', 
                            background: i === 1 ? '#3b82f6' : i === 2 ? '#22c55e' : '#f97316',
                            border: '2px solid #fff',
                            marginLeft: i > 1 ? '-8px' : '0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.625rem',
                            fontWeight: '600',
                            color: '#fff',
                          }}>
                            {i === 3 ? '+' : ''}
                          </div>
                        ))}
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-fg-dim)', fontWeight: '500' }}>
                        +{market.totalTrades.toString()} traders
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-fg-dim)" strokeWidth="2">
                          <path d="M18 20V10M12 20V4M6 20v-6" />
                        </svg>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-fg-dim)', fontWeight: '500' }}>
                          {formatVolume(market.totalVolume)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-fg-dim)" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M12 6v6l4 2" />
                        </svg>
                        <span style={{ fontSize: '0.75rem', color: market.status === 0 ? 'var(--color-accent)' : 'var(--color-fg-dim)', fontWeight: '500' }}>
                          {market.status === 0 ? formatTimeLeft(Number(market.endTime)) : 'Ended'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Admin Resolve Button */}
                  {isOwner && market.status === 0 && (
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border-subtle)', display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowResolveModal({ marketId: market.marketId, outcome: true }); }}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          fontSize: '0.625rem',
                          fontWeight: '600',
                          background: 'var(--color-success)',
                          color: 'var(--color-accent-fg)',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          textTransform: 'uppercase',
                        }}
                      >
                        Resolve YES
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowResolveModal({ marketId: market.marketId, outcome: false }); }}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          fontSize: '0.625rem',
                          fontWeight: '600',
                          background: 'var(--color-danger)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          textTransform: 'uppercase',
                        }}
                      >
                        Resolve NO
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowCancelModal({ marketId: market.marketId }); }}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          fontSize: '0.625rem',
                          fontWeight: '600',
                          background: 'var(--color-fg-dim)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          textTransform: 'uppercase',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {activeTab !== 'cancelled' && activeTab !== 'claims' && filteredMarkets.length > 0 && viewMode === 'list' && (
          <div style={{ 
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}>
            {filteredMarkets.map((market) => {
              const { title, imageUrl } = parseMarketTitle(market.question);
              const displayImageUrl = imageUrl || DEFAULT_PLACEHOLDER;
              const category = CATEGORIES[Number(market.category)] || CATEGORIES[5];
              
              return (
                <article
                  key={`${market.marketId}-${refreshKey}`}
                  onClick={() => navigate(`/market/${market.marketId}`)}
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    height: '72px',
                    opacity: market.status === 0 ? 1 : 0.7,
                  }}
                >
                  <img
                    src={displayImageUrl}
                    alt=""
                    style={{ width: '56px', height: '56px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }}
                    onError={(e) => { e.target.src = DEFAULT_PLACEHOLDER; }}
                  />
                  <div style={{ flex: 1, margin: '0 16px', minWidth: 0 }}>
                    <div style={{ fontSize: '0.625rem', color: category.color, fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px' }}>
                      {category.label}
                    </div>
                    <div style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--color-fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {title}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--color-fg-muted)' }}>Volume</div>
                      <div style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--color-fg)' }}>
                        {formatVolume(market.totalVolume)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--color-fg-muted)' }}>Traders</div>
                      <div style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--color-fg)' }}>
                        {market.totalTrades.toString()}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: '60px' }}>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--color-fg-muted)' }}>Ends</div>
                      <div style={{ fontSize: '0.75rem', fontWeight: '500', color: market.status === 0 ? 'var(--color-accent)' : 'var(--color-fg-dim)' }}>
                        {market.status === 0 ? formatTimeLeft(Number(market.endTime)) : 'Ended'}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
          </div>{/* end .market-main */}
        </div>{/* end .market-layout */}
      </section>

      {/* Create Market Modal */}
      {showCreateModal && (
        <div
          role="dialog"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--color-overlay)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem',
          }}
          onClick={handleCloseCreateModal}
        >
          <div 
            style={{ 
              background: 'var(--color-surface-elevated)', 
              border: '1px solid var(--color-border)', 
              borderRadius: '16px', 
              padding: '2rem',
              width: '100%',
              maxWidth: '440px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--color-fg)', marginBottom: '1.5rem' }}>
              Create New Market
            </h2>
            <form onSubmit={handleCreateMarket}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-fg-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
                  Question
                </label>
                <input
                  type="text"
                  value={newMarket.question}
                  onChange={(e) => setNewMarket({ ...newMarket, question: e.target.value })}
                  placeholder="Will Bitcoin hit $100k by end of 2026?"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    background: 'var(--color-bg)',
                    color: 'var(--color-fg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-fg-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
                  Image URL (Optional)
                </label>
                <input
                  type="url"
                  value={newMarket.imageUrl}
                  onChange={(e) => setNewMarket({ ...newMarket, imageUrl: e.target.value })}
                  placeholder="https://example.com/image.jpg"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    background: 'var(--color-bg)',
                    color: 'var(--color-fg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-fg-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
                  Subcategory (Optional)
                </label>
                <input
                  type="text"
                  value={newMarket.subcategory}
                  onChange={(e) => setNewMarket({ ...newMarket, subcategory: e.target.value })}
                  placeholder="e.g. Bitcoin, NBA, Elections"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    background: 'var(--color-bg)',
                    color: 'var(--color-fg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-fg-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
                  Market Expiration
                </label>
                <input
                  type="datetime-local"
                  value={newMarket.expirationDateTime}
                  min={minExpirationDateTime}
                  max={maxExpirationDateTime}
                  onChange={(e) => setNewMarket({ ...newMarket, expirationDateTime: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    background: 'var(--color-bg)',
                    color: 'var(--color-fg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--color-fg-muted)' }}>
                  {!selectedExpirationTimestamp && 'Select a valid expiration date and time within the next year.'}
                  {selectedExpirationTimestamp && expirationInPast && 'Expiration must be in the future.'}
                  {selectedExpirationTimestamp && expirationTooFar && 'Expiration must be within the next year.'}
                  {selectedExpirationTimestamp && !expirationInPast && !expirationTooFar
                    ? `Stored on-chain as ${selectedExpirationTimestamp} and shown here in ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`
                    : null}
                </div>
                {selectedExpirationTimestamp && (
                  <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: 'var(--color-fg-muted)' }}>
                    Expires {new Date(selectedExpirationTimestamp * 1000).toLocaleString()}
                  </div>
                )}
              </div>
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-fg-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
                  Category
                </label>
                <select
                  value={newMarket.category}
                  onChange={(e) => setNewMarket({ ...newMarket, category: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    background: 'var(--color-bg)',
                    color: 'var(--color-fg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                  }}
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat.id} value={String(cat.id)}>{cat.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                  type="button"
                  onClick={handleCloseCreateModal}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    background: 'var(--color-border)',
                    color: 'var(--color-fg)',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !isCreateMarketFormValid}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    background: isCreating ? 'var(--color-fg-dim)' : 'var(--color-accent)',
                    color: 'var(--color-accent-fg)',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: isCreating ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isCreating ? 'Creating...' : 'Create Market'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Resolve Confirmation Modal */}
      {showResolveModal && (
        <div
          role="dialog"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--color-overlay)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem',
          }}
          onClick={() => setShowResolveModal(null)}
        >
          <div 
            style={{ 
              background: 'var(--color-surface-elevated)', 
              border: '1px solid var(--color-border)', 
              borderRadius: '16px', 
              padding: '2rem',
              width: '100%',
              maxWidth: '400px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--color-fg)', marginBottom: '1rem' }}>
              Resolve Market
            </h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-fg-muted)', marginBottom: '1.5rem' }}>
              Are you sure you want to resolve this market as <strong style={{ color: showResolveModal.outcome ? 'var(--color-success)' : 'var(--color-danger)' }}>{showResolveModal.outcome ? "YES" : "NO"}</strong>?
              This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                onClick={() => setShowResolveModal(null)}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  background: 'var(--color-border)',
                  color: 'var(--color-fg)',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleResolveMarket(showResolveModal.marketId, showResolveModal.outcome)}
                disabled={isResolving}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  background: isResolving ? 'var(--color-fg-dim)' : showResolveModal.outcome ? 'var(--color-success)' : 'var(--color-danger)',
                  color: 'var(--color-accent-fg)',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: isResolving ? 'not-allowed' : 'pointer',
                }}
              >
                {isResolving ? 'Resolving...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Market Modal */}
      {showCancelModal && (
        <div
          role="dialog"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--color-overlay)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem',
          }}
          onClick={() => setShowCancelModal(null)}
        >
          <div 
            style={{ 
              background: 'var(--color-surface-elevated)', 
              border: '1px solid var(--color-border)', 
              borderRadius: '16px', 
              padding: '2rem',
              width: '100%',
              maxWidth: '400px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '1.25rem', fontWeight: '600', color: 'var(--color-fg)', marginBottom: '1rem' }}>
              Cancel Market
            </h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-fg-muted)', marginBottom: '1rem' }}>
              Are you sure you want to cancel this market? This action cannot be undone.
            </p>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-fg-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
                Reason (required)
              </label>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Enter cancellation reason..."
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  fontSize: '0.875rem',
                  background: 'var(--color-bg)',
                  color: 'var(--color-fg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                onClick={() => setShowCancelModal(null)}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  background: 'var(--color-border)',
                  color: 'var(--color-fg)',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleCancelMarket(showCancelModal.marketId)}
                disabled={isCancelling || !cancelReason.trim()}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  background: (isCancelling || !cancelReason.trim()) ? 'var(--color-fg-dim)' : 'var(--color-danger)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: (isCancelling || !cancelReason.trim()) ? 'not-allowed' : 'pointer',
                }}
              >
                {isCancelling ? 'Cancelling...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
