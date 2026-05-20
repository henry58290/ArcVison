import { useState, useMemo } from 'react';

function fmtUsd(v) {
  const sign = v < 0 ? '-' : v > 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function PositionLabel({ side }) {
  const cls = side === 'YES' ? 'text-emerald-500' : 'text-rose-500';
  return <span className={`text-sm font-medium ${cls}`}>{side}</span>;
}

function StatusLabel({ status, outcome }) {
  if (status === 'Active') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-orange-500">
        <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
        Active
      </span>
    );
  }
  if (outcome === 'Won') {
    return <span className="text-sm font-medium text-emerald-500">Won</span>;
  }
  return <span className="text-sm font-medium text-zinc-500">Lost</span>;
}

export default function TradeHistory({ bets }) {
  const [tab, setTab] = useState('active');

  const filtered = useMemo(() => {
    if (tab === 'active') return bets.filter((b) => b.status === 'Active');
    return bets.filter((b) => b.status === 'Resolved');
  }, [tab, bets]);

  const tabBase = 'relative px-1 py-3 text-sm font-medium transition-colors';
  const tabActive = 'text-zinc-100';
  const tabIdle = 'text-zinc-500 hover:text-zinc-300';

  return (
    <section className="rounded-2xl bg-zinc-900/50 border border-zinc-800">
      <div className="flex items-center justify-between px-6 pt-5 pb-3">
        <h3 className="text-sm font-semibold text-zinc-100">Trade History</h3>
        <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
          {filtered.length} {filtered.length === 1 ? 'record' : 'records'}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 px-6 border-b border-zinc-800">
        <button
          onClick={() => setTab('active')}
          className={`${tabBase} ${tab === 'active' ? tabActive : tabIdle}`}
        >
          Active Bets
          {tab === 'active' && (
            <span className="absolute left-0 right-0 -bottom-px h-px bg-zinc-100" />
          )}
        </button>
        <button
          onClick={() => setTab('past')}
          className={`${tabBase} ${tab === 'past' ? tabActive : tabIdle}`}
        >
          Past History
          {tab === 'past' && (
            <span className="absolute left-0 right-0 -bottom-px h-px bg-zinc-100" />
          )}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 py-14 text-center text-sm text-zinc-500">
          No {tab === 'active' ? 'active' : 'resolved'} bets.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left px-6 py-3 text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Market</th>
                <th className="text-left px-3 py-3 text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Side</th>
                <th className="text-right px-3 py-3 text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Wagered</th>
                <th className="text-left px-3 py-3 text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Status</th>
                <th className="text-right px-6 py-3 text-[11px] uppercase tracking-wider text-zinc-500 font-medium">PNL</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.id} className="border-t border-zinc-800/50">
                  <td className="px-6 py-4 max-w-[320px]">
                    <div className="truncate text-zinc-100 font-medium">{b.market}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5 font-medium tracking-wide">
                      {b.date}
                    </div>
                  </td>
                  <td className="px-3 py-4"><PositionLabel side={b.position} /></td>
                  <td className="px-3 py-4 text-right text-zinc-200 tabular-nums font-medium">
                    ${b.wagered.toFixed(2)}
                  </td>
                  <td className="px-3 py-4"><StatusLabel status={b.status} outcome={b.outcome} /></td>
                  <td className={`px-6 py-4 text-right tabular-nums font-medium ${
                    b.pnl > 0 ? 'text-emerald-500' : b.pnl < 0 ? 'text-rose-500' : 'text-zinc-200'
                  }`}>
                    {fmtUsd(b.pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
