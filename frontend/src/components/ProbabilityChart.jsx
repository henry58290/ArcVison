import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useReadContract } from 'wagmi';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { fetchMarketLogs, calculateProbabilityTimeSeries } from './utils/logParser';
import { CONTRACT_ADDRESS, CONTRACT_ABI } from './utils/contracts';

export default function ProbabilityChart({ marketId, initialYesOdds, onDataUpdate }) {
  const chartHeight = 84;
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const intervalRef = useRef(null);
  const marketIdRef = useRef(marketId);

  // Read current odds directly from the contract — used as fallback when no trade logs exist
  const { data: contractOdds } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'getOdds',
    args: [BigInt(marketId)],
    query: { enabled: !!marketId, refetchInterval: 15000 },
  });

  // Prefer contract read, fall back to parent-provided prop
  const currentYesOdds = contractOdds?.[0] != null
    ? Number(contractOdds[0])
    : (initialYesOdds != null ? Number(initialYesOdds) : null);

  const loadData = useCallback(async () => {
    if (!marketIdRef.current) return;

    try {
      const logs = await fetchMarketLogs(Number(marketIdRef.current));
      const dataPoints = calculateProbabilityTimeSeries(logs, Number(marketIdRef.current));

      const formattedData = dataPoints.map(point => ({
        time: point.time,
        value: point.value,
        timeStr: new Date(point.time * 1000).toLocaleDateString()
      }));

      setData(formattedData);
      setLoading(false);
      setError(false);

      if (onDataUpdate && formattedData.length > 0) {
        onDataUpdate(formattedData[formattedData.length - 1].value);
      }
    } catch (err) {
      console.error('Error loading chart data:', err);
      setError(true);
      setLoading(false);
    }
  }, [onDataUpdate]);

  useEffect(() => {
    marketIdRef.current = marketId;
    setLoading(true);
    loadData();

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(loadData, 10000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [marketId, loadData]);

  // Build chart data: use log history if available, else show current contract odds as flat line
  const chartData = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);

    if (data.length > 0) {
      // Append a live "now" point so the chart extends to the current moment
      const lastPoint = data[data.length - 1];
      if (currentYesOdds != null && now > lastPoint.time) {
        const liveValue = parseFloat((currentYesOdds / 100).toFixed(2));
        return [
          ...data,
          { time: now, value: liveValue, timeStr: '' },
        ];
      }
      return data;
    }

    // No trade history — show current contract odds as a flat line
    if (!loading && currentYesOdds != null) {
      const prob = currentYesOdds / 100;
      return [
        { time: now - 3600, value: prob, timeStr: '' },
        { time: now, value: prob, timeStr: '' },
      ];
    }

    return [];
  }, [data, loading, currentYesOdds]);

  // Error state with no data at all
  if (error && chartData.length === 0) {
    return (
      <div style={{
        height: `${chartHeight}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-fg-dim)',
        fontSize: '0.75rem',
      }}>
        Unable to load chart
      </div>
    );
  }

  // Show loader until we have real data (from contract or logs)
  if (loading && chartData.length === 0) {
    return (
      <div style={{
        height: `${chartHeight}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-surface)',
      }}>
        <div style={{
          width: '16px',
          height: '16px',
          border: '2px solid var(--color-border)',
          borderTopColor: 'var(--color-accent)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: `${chartHeight}px`, minHeight: `${chartHeight}px` }}>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis
            dataKey="time"
            tickFormatter={(t) => new Date(t * 1000).toLocaleDateString()}
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
            width={35}
          />
          <Tooltip
            formatter={(value) => [`${value.toFixed(2)}%`, 'YES Probability']}
            labelFormatter={(label) => new Date(label * 1000).toLocaleDateString()}
            contentStyle={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '4px',
              fontSize: '12px',
              color: 'var(--color-fg)'
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--color-success)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: 'var(--color-success)' }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
