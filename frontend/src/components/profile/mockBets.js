/**
 * Persistent trade history backed by localStorage.
 *
 * @typedef {Object} Bet
 * @property {number|string} id
 * @property {string} market         display name of the market
 * @property {'YES' | 'NO'} position
 * @property {number} wagered        USDC wagered
 * @property {'Active' | 'Resolved'} status
 * @property {'Won' | 'Lost' | null} outcome
 * @property {number} pnl            signed USDC; for Active = unrealized
 * @property {string} date           ISO date string (YYYY-MM-DD)
 * @property {string} [txHash]       on-chain tx hash, when applicable
 */

export const BETS_STORAGE_KEY = 'Verdict_bets';

/** Fallback set used the first time a user lands on the profile page. */
/** @type {Bet[]} */
export const DEFAULT_BETS = [
  {
    id: 'seed-1',
    market: 'Will BTC hit $150k by end of 2026?',
    position: 'YES',
    wagered: 250.00,
    status: 'Active',
    outcome: null,
    pnl: 85.50,
    date: '2026-04-12',
  },
  {
    id: 'seed-2',
    market: 'Will SpaceX reach Mars orbit in 2026?',
    position: 'NO',
    wagered: 100.00,
    status: 'Resolved',
    outcome: 'Won',
    pnl: 120.00,
    date: '2026-03-28',
  },
  {
    id: 'seed-3',
    market: 'Will the Fed cut rates in Q2?',
    position: 'YES',
    wagered: 500.00,
    status: 'Resolved',
    outcome: 'Lost',
    pnl: -500.00,
    date: '2026-03-15',
  },
  {
    id: 'seed-4',
    market: 'Will ETH flip BTC by market cap this year?',
    position: 'NO',
    wagered: 75.00,
    status: 'Active',
    outcome: null,
    pnl: -12.30,
    date: '2026-04-22',
  },
];

/**
 * Read bets from localStorage. Returns DEFAULT_BETS if empty / invalid.
 * @returns {Bet[]}
 */
export function loadBets() {
  try {
    const raw = localStorage.getItem(BETS_STORAGE_KEY);
    if (!raw) return DEFAULT_BETS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_BETS;
    return parsed;
  } catch {
    return DEFAULT_BETS;
  }
}

/**
 * Append a new bet to the persisted list. Seeds the list with DEFAULT_BETS
 * the first time so the user sees their history alongside the demo entries.
 * @param {Bet} bet
 * @returns {Bet[]} the new full list
 */
export function appendBet(bet) {
  const existing = loadBets();
  const next = [bet, ...existing];
  try {
    localStorage.setItem(BETS_STORAGE_KEY, JSON.stringify(next));
    // Notify same-tab listeners — `storage` only fires cross-tab.
    window.dispatchEvent(new CustomEvent('Verdict:bets-changed'));
  } catch { /* ignore */ }
  return next;
}

/**
 * Aggregate stats derived from a bets array.
 *
 * Existing fields (totalProfit, totalLoss, netPnl, activeCount, resolvedCount)
 * are unchanged. Extended fields power the profile metric tiles:
 *   openPnl     — unrealized P&L summed across Active positions
 *   realizedPnl — alias of netPnl (resolved only)
 *   roiPct      — realized P&L as % of resolved wager
 *   winCount/lossCount/winRate — resolved win/loss tally
 *   volume      — total USDC wagered (all bets)
 *   marketsCount — distinct markets traded
 */
export function computeStats(bets) {
  const list = bets || loadBets();
  let totalProfit = 0;
  let totalLoss = 0;
  let resolvedWagered = 0;
  let openPnl = 0;
  let volume = 0;
  let winCount = 0;
  let lossCount = 0;

  for (const b of list) {
    volume += b.wagered || 0;
    if (b.status === 'Active') {
      openPnl += b.pnl || 0;
      continue;
    }
    if (b.status === 'Resolved') {
      resolvedWagered += b.wagered || 0;
      if (b.pnl > 0) totalProfit += b.pnl;
      else totalLoss += Math.abs(b.pnl);
      if (b.outcome === 'Won') winCount += 1;
      else if (b.outcome === 'Lost') lossCount += 1;
    }
  }

  const netPnl = totalProfit - totalLoss;
  const activeCount = list.filter((b) => b.status === 'Active').length;
  const resolvedCount = list.filter((b) => b.status === 'Resolved').length;

  return {
    totalProfit,
    totalLoss,
    netPnl,
    activeCount,
    resolvedCount,
    openPnl,
    realizedPnl: netPnl,
    roiPct: resolvedWagered > 0 ? (netPnl / resolvedWagered) * 100 : 0,
    winCount,
    lossCount,
    winRate: resolvedCount > 0 ? (winCount / resolvedCount) * 100 : 0,
    volume,
    marketsCount: new Set(list.map((b) => b.market)).size,
  };
}

/**
 * Cumulative realized-P&L series for the profile chart.
 * Walks resolved bets in date order, summing pnl. Returns an array of numbers
 * (USDC) including a leading baseline so a line always has ≥2 anchors.
 *
 * @param {Bet[]} bets
 * @param {'7d'|'30d'|'all'} range
 * @returns {number[]}
 */
export function cumulativePnl(bets, range = 'all') {
  const list = bets || loadBets();
  const resolved = list
    .filter((b) => b.status === 'Resolved' && b.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  let running = 0;
  const full = resolved.map((b) => {
    running += b.pnl;
    return { date: b.date, value: running };
  });

  let points = full;
  let startValue = 0;

  if (range === '7d' || range === '30d') {
    const days = range === '7d' ? 7 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const idx = full.findIndex((p) => p.date >= cutoffStr);
    if (idx === -1) {
      const last = full.length ? full[full.length - 1].value : 0;
      return [last, last];
    }
    points = full.slice(idx);
    startValue = idx > 0 ? full[idx - 1].value : 0;
  }

  const values = [startValue, ...points.map((p) => p.value)];
  if (values.length < 2) values.push(values[0] ?? 0);
  return values;
}

/** @deprecated kept for backwards compat — prefer DEFAULT_BETS / loadBets() */
export const MOCK_BETS = DEFAULT_BETS;
