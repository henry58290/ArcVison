function fmt(value) {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function StatCard({ label, value, tone = 'neutral' }) {
  const valueColor = {
    profit: 'text-emerald-500',
    loss: 'text-rose-500',
    neutral: 'text-zinc-100',
  }[tone];

  return (
    <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800 p-5">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-3">
        {label}
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${valueColor}`}>
        {fmt(value)}
      </div>
      <div className="text-[11px] text-zinc-600 font-medium mt-1.5 tracking-wide">
        USDC
      </div>
    </div>
  );
}

export default function StatsCards({ stats }) {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <StatCard label="Total Profit" value={stats.totalProfit} tone="profit" />
      <StatCard label="Total Loss" value={stats.totalLoss} tone="loss" />
      <StatCard
        label="Net PNL"
        value={stats.netPnl}
        tone={stats.netPnl >= 0 ? 'profit' : 'loss'}
      />
    </section>
  );
}
