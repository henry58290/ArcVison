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

function parseMarketTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== "string") {
    return { title: "", imageUrl: null };
  }
  const parts = rawTitle.split(IMAGE_SEPARATOR);
  if (parts.length >= 2 && parts[1].trim()) {
    return { title: parts[0].trim(), imageUrl: parts[1].trim() };
  }
  return { title: rawTitle, imageUrl: null };
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
  const [newMarket, setNewMarket] = useState({ question: "", duration: "604800", imageUrl: "", category: "0" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [chartRefreshKey, setChartRefreshKey] = useState(0);
  const [marketCache, setMarketCache] = useState({});
  const [activeTab, setActiveTab] = useState("open");
  const [selectedCategory, setSelectedCategory] = useState(null);
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
      setNewMarket({ question: "", duration: "604800", imageUrl: "", category: "0" });
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
    setNewMarket({ question: "", duration: "604800", imageUrl: "", category: "0" });
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

  const handleCreateMarket = (e) => {
    e.preventDefault();
    if (!newMarket.question || !newMarket.duration) return;
    const encodedTitle = newMarket.imageUrl && newMarket.imageUrl.trim()
      ? `${newMarket.question.trim()}${IMAGE_SEPARATOR}${newMarket.imageUrl.trim()}`
      : newMarket.question.trim();
    createMarketWrite({
      address: CONTRACT_ADDRESS,
      abi: CONTRACT_ABI,
      functionName: "createMarket",
      args: [encodedTitle, BigInt(newMarket.duration), Number(newMarket.category)],
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

  const filteredMarkets = useMemo(() => {
    if (activeTab === 'claims' || activeTab === 'cancelled') return [];
    let result;
    if (activeTab === 'open') result = markets.filter(m => m.status === 0);
    else if (activeTab === 'resolved') result = markets.filter(m => m.status === 1);
    else result = markets;
    if (selectedCategory !== null) {
      result = result.filter(m => Number(m.category) === selectedCategory);
    }
    return result;
  }, [markets, activeTab, selectedCategory]);

  return (
    <main style={{ paddingTop: '100px', paddingBottom: '80px', minHeight: '100vh' }}>
      {/* Hero Section */}
      <section style={{ maxWidth: '1400px', margin: '0 auto 3rem', padding: '0 1rem' }}>
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
      <section id="markets" style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 1rem' }}>
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
        </div>

        {/* Category Filters — visible on Open / Resolved tabs */}
        {(activeTab === 'open' || activeTab === 'resolved') && (
          <div style={{
            display: 'flex', gap: '0.375rem', marginBottom: '1.5rem',
            overflowX: 'auto', WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none', msOverflowStyle: 'none',
            paddingBottom: '2px', flexWrap: 'wrap',
          }}>
            <button
              onClick={() => setSelectedCategory(null)}
              style={{
                padding: '0.3rem 0.65rem',
                fontSize: '0.6875rem',
                fontWeight: '600',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                borderRadius: '4px',
                cursor: 'pointer',
                border: `1px solid ${selectedCategory === null ? 'var(--color-accent)' : 'var(--color-border)'}`,
                background: selectedCategory === null ? 'var(--color-accent-muted)' : 'transparent',
                color: selectedCategory === null ? 'var(--color-accent)' : 'var(--color-fg-muted)',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              All
            </button>
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                style={{
                  padding: '0.3rem 0.65rem',
                  fontSize: '0.6875rem',
                  fontWeight: '600',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  border: `1px solid ${selectedCategory === cat.id ? cat.color : 'var(--color-border)'}`,
                  background: selectedCategory === cat.id ? cat.bg : 'transparent',
                  color: selectedCategory === cat.id ? cat.color : 'var(--color-fg-muted)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>
        )}

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
              <div style={{ 
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '1.5rem',
              }}>
                {eligibleClaims.map((claim) => {
                  const { title, imageUrl } = parseMarketTitle(claim.question);
                  const displayImageUrl = imageUrl || DEFAULT_PLACEHOLDER;
                  return (
                  <article
                    key={claim.marketId}
                    style={{ 
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: '12px',
                      padding: '1.5rem',
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
                  const { title, imageUrl } = parseMarketTitle(claim.question);
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
              <div style={{ 
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '1.5rem',
              }}>
                {pendingRefunds.map((refund) => (
                  <article
                    key={refund.marketId}
                    style={{ 
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: '12px',
                      padding: '1.5rem',
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
                      {refund.question}
                    </h3>
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
                ))}
              </div>
            )}
          </div>
        ) : null}
        
        {activeTab !== 'cancelled' && activeTab !== 'claims' && filteredMarkets.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-fg-dim)' }}>
            No {activeTab} markets available. {isOwner && activeTab === 'open' && "Create one to get started!"}
          </div>
        )}
        
        {activeTab !== 'cancelled' && activeTab !== 'claims' && filteredMarkets.length > 0 && (
          <div style={{ 
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '1.5rem',
          }}>
            {filteredMarkets.map((market) => {
              const { title, imageUrl } = parseMarketTitle(market.question);
              const yesPercent = market.yesOdds ? Math.round(Number(market.yesOdds) / 100) : 50;
              const noPercent = 100 - yesPercent;
              const displayImageUrl = imageUrl || DEFAULT_PLACEHOLDER;
              
              return (
                <article
                  key={`${market.marketId}-${refreshKey}`}
                  style={{ 
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: '12px',
                    padding: '1.5rem',
                    cursor: 'pointer',
                    transition: 'all 0.25s ease',
                    opacity: market.status === 0 ? 1 : 0.7,
                  }}
                  onClick={() => navigate(`/market/${market.marketId}`)}
                >
                  {/* Card Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', flexWrap: 'wrap' }}>
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
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-fg-dim)' }}>
                      {market.status === 0 ? `Ends in ${formatTimeLeft(Number(market.endTime))}` : `Ended`}
                    </span>
                  </div>

                  {/* Image */}
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

                  {/* Title */}
                  <h3 style={{ fontSize: '1.125rem', fontWeight: '600', color: 'var(--color-fg)', marginBottom: '0.5rem', lineHeight: 1.4 }}>
                    {title}
                  </h3>

                  {/* Probability Chart */}
                  <div style={{ marginBottom: '1rem', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--color-border-subtle)' }}>
                    <ProbabilityChart key={chartRefreshKey} marketId={market.marketId} initialYesOdds={market.yesOdds} />
                  </div>

                  {/* Progress Bar */}
                  {market.status === 0 && (
                    <div style={{ marginBottom: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--color-success)', fontWeight: '600' }}>YES {yesPercent}%</span>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--color-danger)', fontWeight: '600' }}>NO {noPercent}%</span>
                      </div>
                      <div style={{ height: '6px', background: 'var(--color-surface-elevated)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${yesPercent}%`, background: 'var(--color-success)', borderRadius: '4px', transition: 'width 0.4s ease' }} />
                      </div>
                    </div>
                  )}

                  {/* Resolution Result */}
                  {market.status === 1 && (
                    <div style={{ marginBottom: '1rem', padding: '0.5rem', background: market.outcome ? 'var(--color-success-bg)' : 'var(--color-danger-bg)', borderRadius: '4px', textAlign: 'center' }}>
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
                    <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--color-danger-bg)', borderRadius: '4px' }}>
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
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-fg-dim)' }}>
                      {market.status === 2 
                        ? `Volume: ${formatVolume((cancelledMarketInfo[market.marketId]?.totalYesAtCancel || 0n) + (cancelledMarketInfo[market.marketId]?.totalNoAtCancel || 0n))}`
                        : `Volume: ${formatVolume(market.totalVolume)}`
                      }
                    </span>
                    {market.status === 0 ? (
                      <span style={{
                        padding: '6px 14px',
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        background: 'var(--color-accent)',
                        color: 'var(--color-accent-fg)',
                        borderRadius: '8px',
                        textTransform: 'uppercase',
                      }}>
                        Trade →
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.625rem', color: 'var(--color-fg-dim)' }}>
                        {market.status === 2 
                          ? `${cancelledMarketInfo[market.marketId]?.totalTradesAtCancel?.toString() || '0'} trades`
                          : `${market.totalTrades.toString()} trades`
                        }
                      </span>
                    )}
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
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-fg-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
                  Duration (seconds)
                </label>
                <select
                  value={newMarket.duration}
                  onChange={(e) => setNewMarket({ ...newMarket, duration: e.target.value })}
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
                  <option value="86400">1 Day</option>
                  <option value="259200">3 Days</option>
                  <option value="604800">1 Week</option>
                  <option value="2592000">1 Month</option>
                  <option value="7884000">3 Months</option>
                </select>
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
                  disabled={isCreating || !newMarket.question}
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
