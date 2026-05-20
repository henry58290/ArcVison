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

export const BETS_STORAGE_KEY = 'arcvision_bets';

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
    window.dispatchEvent(new CustomEvent('arcvision:bets-changed'));
  } catch { /* ignore */ }
  return next;
}

/** Aggregate stats derived from a bets array. */
export function computeStats(bets) {
  const list = bets || loadBets();
  let totalProfit = 0;
  let totalLoss = 0;
  for (const b of list) {
    if (b.status !== 'Resolved') continue;
    if (b.pnl > 0) totalProfit += b.pnl;
    else totalLoss += Math.abs(b.pnl);
  }
  return {
    totalProfit,
    totalLoss,
    netPnl: totalProfit - totalLoss,
    activeCount: list.filter((b) => b.status === 'Active').length,
    resolvedCount: list.filter((b) => b.status === 'Resolved').length,
  };
}

/** @deprecated kept for backwards compat — prefer DEFAULT_BETS / loadBets() */
export const MOCK_BETS = DEFAULT_BETS;
