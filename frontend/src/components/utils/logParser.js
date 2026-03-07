import { getCachedLogs, saveLogs } from './indexedDb';

// BlockScout V1 (Etherscan-compatible) API — includes timestamps per-log,
// supports fromBlock/toBlock for incremental fetching, and topic filtering.
const BLOCKSCOUT_API = 'https://testnet.arcscan.app/api';
const CONTRACT_ADDRESS = '0xCf5385D36e6E88D224678B98AaC8BF0864dc2808';

// keccak256 of PositionPlaced(uint256,address,bool,uint256,uint256,uint256,uint256,uint256)
const POSITION_PLACED_TOPIC = '0x39030e804a1c2a4713d5e4cfee4b24625c6ccea154822bcce5e09c6798f40863';

/**
 * Decode a PositionPlaced event log from BlockScout V1 API format.
 *
 * Event signature:
 *   PositionPlaced(uint256 indexed marketId, address indexed user,
 *     bool side, uint256 amount, uint256 yesOdds, uint256 noOdds,
 *     uint256 totalYes, uint256 totalNo)
 *
 * topics[0] = event signature hash
 * topics[1] = marketId  (indexed)
 * topics[2] = user addr (indexed)
 * data      = side(bool) | amount | yesOdds | noOdds | totalYes | totalNo
 *             6 × 32 bytes = 384 bytes hex + "0x" prefix = 386 chars
 *
 * V1 API fields: blockNumber (hex), timeStamp (hex), data, topics[], transactionHash
 */
function decodePositionPlacedLog(log) {
  try {
    const topics = log.topics || [];
    if (!topics[0] || topics[0].toLowerCase() !== POSITION_PLACED_TOPIC) return null;
    if (!topics[1]) return null;

    const marketId = Number(BigInt(topics[1]));
    const data = log.data || '0x';

    // 6 params × 64 hex chars + 2 for "0x" = 386 min length
    if (data.length < 386) return null;

    // Offsets (hex chars after "0x"):
    //   side     [2..66]    — bool, not needed for chart
    //   amount   [66..130]  — not needed for chart
    //   yesOdds  [130..194] — contract-computed, scaled ×10000, includes virtual liquidity
    //   noOdds   [194..258] — contract-computed, scaled ×10000
    //   totalYes [258..322] — raw pool (wei), not needed for chart
    //   totalNo  [322..386] — raw pool (wei), not needed for chart
    const yesOdds = Number(BigInt('0x' + data.slice(130, 194)));
    const noOdds  = Number(BigInt('0x' + data.slice(194, 258)));

    return {
      marketId,
      yesOdds,
      noOdds,
      blockNumber: parseInt(log.blockNumber, 16),
      timestamp: parseInt(log.timeStamp, 16),
      transactionHash: log.transactionHash,
    };
  } catch (error) {
    console.error('Error decoding PositionPlaced log:', error);
    return null;
  }
}

/**
 * Fetch PositionPlaced logs for a specific market.
 *
 * Uses incremental fetching:
 *   1. Read cached logs + lastBlock from IndexedDB
 *   2. Fetch only new logs since lastBlock+1 via V1 API
 *   3. Merge, deduplicate, sort, and persist
 *   4. Falls back to cached data if the API call fails
 */
export async function fetchMarketLogs(marketId) {
  const cached = await getCachedLogs(marketId);
  const existingLogs = cached?.logs || [];
  const lastBlock = cached?.lastBlock || 0;

  // Incremental: start from block after the last one we have
  const fromBlock = lastBlock > 0 ? lastBlock + 1 : 0;

  try {
    // Encode marketId as bytes32 hex for topic1 filtering so the API
    // only returns events for THIS market instead of all markets.
    // Without this, pages fill with other-market events and our
    // market's newer events become unreachable past the page limit.
    const marketIdHex = '0x' + BigInt(marketId).toString(16).padStart(64, '0');

    const params = new URLSearchParams({
      module: 'logs',
      action: 'getLogs',
      address: CONTRACT_ADDRESS,
      topic0: POSITION_PLACED_TOPIC,
      topic0_1_opr: 'and',
      topic1: marketIdHex,
      fromBlock: String(fromBlock),
      toBlock: 'latest',
    });

    const response = await fetch(`${BLOCKSCOUT_API}?${params}`);
    if (!response.ok) return existingLogs;

    const json = await response.json();

    // V1 returns status "0" with "No records found" when empty
    if (json.status !== '1' || !Array.isArray(json.result)) {
      return existingLogs;
    }

    // Compute the highest block in the API response so we can advance
    // our cursor past this page even if no results match this market.
    // Prevents infinite stall when a page contains only non-matching events.
    const apiHighBlock = json.result.reduce((max, l) => {
      const bn = parseInt(l.blockNumber, 16);
      return bn > max ? bn : max;
    }, lastBlock);

    // Decode and filter for this market
    const newLogs = json.result
      .map(decodePositionPlacedLog)
      .filter(log => log !== null && log.marketId === Number(marketId));

    if (newLogs.length === 0) {
      // No matching logs in this page — advance cursor to skip past it
      if (apiHighBlock > lastBlock) {
        await saveLogs(marketId, existingLogs, apiHighBlock);
      }
      return existingLogs;
    }

    // Merge with existing, deduplicate by txHash
    const seen = new Set(existingLogs.map(l => l.transactionHash));
    const uniqueNew = newLogs.filter(l => !seen.has(l.transactionHash));

    if (uniqueNew.length === 0) {
      // All "new" logs already cached — still advance cursor
      if (apiHighBlock > lastBlock) {
        await saveLogs(marketId, existingLogs, apiHighBlock);
      }
      return existingLogs;
    }

    const allLogs = [...existingLogs, ...uniqueNew];
    allLogs.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      return a.transactionHash.localeCompare(b.transactionHash);
    });

    const newLastBlock = Math.max(apiHighBlock, ...allLogs.map(l => l.blockNumber));
    await saveLogs(marketId, allLogs, newLastBlock);

    return allLogs;
  } catch (error) {
    console.error('Error fetching market logs:', error);
    return existingLogs;
  }
}

/**
 * Convert logs into probability data points for charting.
 *
 * Uses the contract-computed yesOdds (which includes virtual liquidity dampening)
 * rather than raw totalYes/totalNo pool ratios — this matches the odds shown
 * elsewhere in the UI and what the contract reports via getOdds().
 *
 * Returns an empty array when no logs exist. The chart component handles empty
 * state by reading current odds from the contract directly.
 */
export function calculateProbabilityTimeSeries(logs, marketId) {
  const marketLogs = logs
    .filter(log => log.marketId === Number(marketId))
    .sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      return a.transactionHash.localeCompare(b.transactionHash);
    });

  if (marketLogs.length === 0) return [];

  return marketLogs.map(log => ({
    time: log.timestamp,
    value: log.yesOdds / 100, // yesOdds scaled ×10000 → /100 = percentage
  }));
}
