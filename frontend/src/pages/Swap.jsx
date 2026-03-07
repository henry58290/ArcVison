import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useBalance } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import TokenSelector from '../components/TokenSelector';
import { useNotification } from '../components/NotificationProvider';
import { 
  DEX_CONSTANTS, 
  ERC20_ABI, 
  ROUTER_ABI, 
  TOKENS, 
  formatTokenBalance,
  TOKEN_ADDRESSES,
  DEFAULT_TOKEN_LIST
} from '../components/utils/tokens';

const NATIVE_ADDRESS = '0x0000000000000000000000000000000000000000';
const MIN_LIQUIDITY_THRESHOLD = BigInt(1000);

const FACTORY_ABI = [{
  inputs: [
    { internalType: 'address', name: '', type: 'address' },
    { internalType: 'address', name: '', type: 'address' },
  ],
  name: 'getPair',
  outputs: [{ internalType: 'address', name: '', type: 'address' }],
  stateMutability: 'view',
  type: 'function',
}];

const PAIR_ABI = [
  {
    inputs: [],
    name: 'getReserves',
    outputs: [
      { internalType: 'uint112', name: 'reserve0', type: 'uint112' },
      { internalType: 'uint112', name: 'reserve1', type: 'uint112' },
      { internalType: 'uint32', name: 'blockTimestampLast', type: 'uint32' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token0',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
];

function SwapPage() {
  const { address, isConnected } = useAccount();
  const { addNotification } = useNotification();
  const lastSwapRef = useRef(null);
  const t = (key) => key;
  const slippageTolerance = 'Slippage Tolerance';
  const connectWalletPrompt = 'Please connect your wallet';
  const enterAmount = 'Please enter an amount';
  const [fromToken, setFromToken] = useState(TOKENS.USDC);
  const [toToken, setToToken] = useState(TOKENS.AVN);
  const [fromAmount, setFromAmount] = useState('');
  const [slippage, setSlippage] = useState(0.5);
  const [showSettings, setShowSettings] = useState(false);
  const [swapError, setSwapError] = useState('');
  const [swapSuccess, setSwapSuccess] = useState(false);

  const fromTokenAddress = fromToken.address;
  const toTokenAddress = toToken.address;
  const isFromNative = fromTokenAddress === NATIVE_ADDRESS;
  const isToNative = toTokenAddress === NATIVE_ADDRESS;

  const wUSDC_ADDRESS = TOKEN_ADDRESSES.wUSDC;

  // Use wrapped address for factory lookups (factory only knows ERC20 pairs, not native 0x0)
  const factoryFromAddr = isFromNative ? wUSDC_ADDRESS : fromTokenAddress;
  const factoryToAddr = isToNative ? wUSDC_ADDRESS : toTokenAddress;

  const { data: nativeBalance, refetch: refetchNativeBalance } = useBalance({
    address: address,
    query: { enabled: !!address }
  });

  const { data: fromTokenBalance, refetch: refetchFromTokenBalance } = useReadContract({
    address: isFromNative ? undefined : fromTokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !isFromNative }
  });

  const { data: toTokenBalance, refetch: refetchToTokenBalance } = useReadContract({
    address: isToNative ? undefined : toTokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !isToNative }
  });

  const { data: fromAllowance, refetch: refetchFromAllowance } = useReadContract({
    address: isFromNative ? undefined : fromTokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, DEX_CONSTANTS.router] : undefined,
    query: { enabled: !!address && !isFromNative }
  });

  const { data: fromTokenDecimals } = useReadContract({
    address: isFromNative ? undefined : fromTokenAddress,
    abi: ERC20_ABI,
    functionName: 'decimals',
    query: { enabled: !isFromNative }
  });

  const { data: toTokenDecimals } = useReadContract({
    address: isToNative ? undefined : toTokenAddress,
    abi: ERC20_ABI,
    functionName: 'decimals',
    query: { enabled: !isToNative }
  });

  const decimals = useMemo(() => ({
    from: fromTokenDecimals || 18,
    to: toTokenDecimals || 18,
  }), [fromTokenDecimals, toTokenDecimals]);

  const getPoolReserves = useCallback((tokenA, tokenB) => {
    const isDirectPair = (tokenA !== NATIVE_ADDRESS && tokenB !== NATIVE_ADDRESS);
    return { isDirectPair, tokenA, tokenB };
  }, []);

  const { data: directPairAddress } = useReadContract({
    address: DEX_CONSTANTS.factory,
    abi: FACTORY_ABI,
    functionName: 'getPair',
    args: [factoryFromAddr, factoryToAddr],
  });

  const { data: viaUSDCPair1 } = useReadContract({
    address: DEX_CONSTANTS.factory,
    abi: FACTORY_ABI,
    functionName: 'getPair',
    args: [factoryFromAddr, wUSDC_ADDRESS],
  });

  const { data: viaUSDCPair2 } = useReadContract({
    address: DEX_CONSTANTS.factory,
    abi: FACTORY_ABI,
    functionName: 'getPair',
    args: [wUSDC_ADDRESS, factoryToAddr],
  });

  const { data: directReserves } = useReadContract({
    address: directPairAddress && directPairAddress !== NATIVE_ADDRESS ? directPairAddress : undefined,
    abi: PAIR_ABI,
    functionName: 'getReserves',
    query: { enabled: !!directPairAddress && directPairAddress !== NATIVE_ADDRESS }
  });

  const { data: viaReserves1 } = useReadContract({
    address: viaUSDCPair1 && viaUSDCPair1 !== NATIVE_ADDRESS ? viaUSDCPair1 : undefined,
    abi: PAIR_ABI,
    functionName: 'getReserves',
    query: { enabled: !!viaUSDCPair1 && viaUSDCPair1 !== NATIVE_ADDRESS }
  });

  const { data: viaReserves2 } = useReadContract({
    address: viaUSDCPair2 && viaUSDCPair2 !== NATIVE_ADDRESS ? viaUSDCPair2 : undefined,
    abi: PAIR_ABI,
    functionName: 'getReserves',
    query: { enabled: !!viaUSDCPair2 && viaUSDCPair2 !== NATIVE_ADDRESS }
  });

  const { writeContract: approve, isPending: isApproving } = useWriteContract();
  const { writeContract: swap, isPending: isSwapping, data: swapHash, error: swapWriteError } = useWriteContract();
  
  const { isSuccess: isSwapConfirmed } = useWaitForTransactionReceipt({
    hash: swapHash,
  });

  const [pendingApproveHash, setPendingApproveHash] = useState(null);
  const { isSuccess: isApproveConfirmed } = useWaitForTransactionReceipt({
    hash: pendingApproveHash,
  });

  useEffect(() => {
    if (isApproveConfirmed) {
      refetchFromAllowance();
      setPendingApproveHash(null);
    }
  }, [isApproveConfirmed]);

  const getSwapPath = useCallback((from, to) => {
    const fromAddr = from.address;
    const toAddr = to.address;
    const fromIsNative = fromAddr === NATIVE_ADDRESS;
    const toIsNative = toAddr === NATIVE_ADDRESS;

    if (fromAddr === toAddr) {
      return null;
    }

    if (fromIsNative && toIsNative) {
      return [wUSDC_ADDRESS, toAddr];
    }
    if (fromIsNative) {
      return [wUSDC_ADDRESS, toAddr];
    }
    if (toIsNative) {
      return [fromAddr, wUSDC_ADDRESS];
    }
    return [fromAddr, toAddr];
  }, [wUSDC_ADDRESS]);

  const isSameToken = fromTokenAddress === toTokenAddress;
  const swapPath = useMemo(() => {
    if (isSameToken) return null;
    return getSwapPath(fromToken, toToken);
  }, [getSwapPath, fromToken, toToken, isSameToken]);

  const { data: estimatedOutput, refetch: refetchEstimate } = useReadContract({
    address: DEX_CONSTANTS.router,
    abi: ROUTER_ABI,
    functionName: 'getAmountsOut',
    args: fromAmount && parseFloat(fromAmount) > 0 ? [parseUnits(fromAmount, 18), swapPath] : undefined,
    query: {
      enabled: !!fromAmount && parseFloat(fromAmount) > 0 && !!swapPath && swapPath.length >= 2,
    }
  });

  useEffect(() => {
    if (isSwapConfirmed) {
      const info = lastSwapRef.current;
      if (info) {
        addNotification(
          `Swap ${info.amount} ${info.fromSymbol} to ${info.toSymbol}`,
          swapHash,
        );
        lastSwapRef.current = null;
      }
      setSwapSuccess(true);
      setFromAmount('');
      setTimeout(() => {
        refetchNativeBalance();
        refetchFromTokenBalance();
        refetchToTokenBalance();
        refetchFromAllowance();
        refetchEstimate();
      }, 100);
      setTimeout(() => setSwapSuccess(false), 4000);
    }
  }, [isSwapConfirmed]);

  useEffect(() => {
    if (swapWriteError) {
      console.error('Swap write error:', swapWriteError);
      const msg = swapWriteError.message?.slice(0, 120) || 'Transaction failed';
      setSwapError(msg);
    }
  }, [swapWriteError]);

  const isWrapOrUnwrap = useMemo(() => {
    return (fromTokenAddress === NATIVE_ADDRESS && toTokenAddress === wUSDC_ADDRESS) ||
           (fromTokenAddress === wUSDC_ADDRESS && toTokenAddress === NATIVE_ADDRESS);
  }, [fromTokenAddress, toTokenAddress]);

  const outputAmount = useMemo(() => {
    if (isWrapOrUnwrap && fromAmount && parseFloat(fromAmount) > 0) {
      return parseUnits(fromAmount, 18);
    }
    if (!estimatedOutput || estimatedOutput.length < 2) return null;
    return estimatedOutput[estimatedOutput.length - 1];
  }, [estimatedOutput, isWrapOrUnwrap, fromAmount]);

  const canSwap = useMemo(() => {
    if (isSameToken) return false;
    if (!fromAmount || parseFloat(fromAmount) <= 0) return false;
    if (!outputAmount || outputAmount === 0n) return false;
    return true;
  }, [isSameToken, fromAmount, outputAmount]);

  const priceImpact = useMemo(() => {
    if (!canSwap || !outputAmount || !fromAmount || parseFloat(fromAmount) === 0) return null;
    
    let reserveIn, reserveOut;
    if (directPairAddress && directPairAddress !== NATIVE_ADDRESS && directReserves) {
      // Uniswap V2 pairs return reserves in token0/token1 order (sorted by address)
      const fromIsToken0 = factoryFromAddr.toLowerCase() < factoryToAddr.toLowerCase();
      reserveIn = fromIsToken0 ? directReserves[0] : directReserves[1];
      reserveOut = fromIsToken0 ? directReserves[1] : directReserves[0];
    } else if (viaUSDCPair1 && viaUSDCPair1 !== NATIVE_ADDRESS && viaUSDCPair2 && viaUSDCPair2 !== NATIVE_ADDRESS && viaReserves1 && viaReserves2) {
      // For multi-hop via wUSDC, determine ordering for each pair
      const fromIsToken0InPair1 = factoryFromAddr.toLowerCase() < wUSDC_ADDRESS.toLowerCase();
      reserveIn = fromIsToken0InPair1 ? viaReserves1[0] : viaReserves1[1];
      const wusdcIsToken0InPair2 = wUSDC_ADDRESS.toLowerCase() < factoryToAddr.toLowerCase();
      reserveOut = wusdcIsToken0InPair2 ? viaReserves2[1] : viaReserves2[0];
    } else {
      return null;
    }

    if (!reserveIn || !reserveOut || reserveIn === 0n || reserveOut === 0n) return null;
    
    const midPrice = parseFloat(formatUnits(reserveOut, 18)) / parseFloat(formatUnits(reserveIn, 18));
    const executionPrice = parseFloat(formatUnits(outputAmount, 18)) / parseFloat(fromAmount);
    
    if (midPrice === 0) return null;
    return ((midPrice - executionPrice) / midPrice) * 100;
  }, [canSwap, directPairAddress, directReserves, viaUSDCPair1, viaUSDCPair2, viaReserves1, viaReserves2, outputAmount, fromAmount, factoryFromAddr, factoryToAddr, wUSDC_ADDRESS]);

  const minReceive = useMemo(() => {
    if (!outputAmount) return null;
    const slippageMultiplier = (100 - slippage) / 100;
    return (outputAmount * BigInt(Math.floor(slippageMultiplier * 10000))) / 10000n;
  }, [outputAmount, slippage]);

  const needsApproval = useMemo(() => {
    if (isFromNative) return false;
    if (pendingApproveHash && !isApproveConfirmed) return false;
    if (!fromAllowance || fromAllowance === undefined) return true;
    if (!fromAmount || parseFloat(fromAmount) <= 0) return false;
    return parseUnits(fromAmount, 18) > fromAllowance;
  }, [fromAllowance, fromAmount, isFromNative, pendingApproveHash, isApproveConfirmed]);

  const displayFromBalance = isFromNative ? nativeBalance?.value : fromTokenBalance;
  const displayToBalance = isToNative ? nativeBalance?.value : toTokenBalance;

  const handleApprove = async () => {
    try {
      setSwapError('');
      setSwapSuccess(false);
      
      if (!address) {
        setSwapError('Please connect your wallet');
        return;
      }
      
      const hash = approve({
        address: fromTokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [DEX_CONSTANTS.router, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
      });
      
      if (hash) {
        setPendingApproveHash(hash);
      }
    } catch (err) {
      console.error('Approve error:', err);
      setSwapError(err?.message?.slice(0, 120) || 'Approval failed');
    }
  };

  const handleSwap = async () => {
    setSwapError('');
    setSwapSuccess(false);
    
    if (!address) {
      setSwapError(connectWalletPrompt);
      return;
    }
    
    if (!fromAmount || parseFloat(fromAmount) <= 0) {
      setSwapError(enterAmount);
      return;
    }
    if (!canSwap) {
      if (isSameToken) {
        setSwapError(t("sameToken"));
        return;
      }
      setSwapError(t("noLiquidity"));
      return;
    }
    if (!minReceive) {
      setSwapError(t("outputCalc"));
      return;
    }

    const hasLiquidity = (directPairAddress && directPairAddress !== NATIVE_ADDRESS && directReserves && directReserves[0] > 0n) ||
                         (viaUSDCPair1 && viaUSDCPair1 !== NATIVE_ADDRESS && viaUSDCPair2 && viaUSDCPair2 !== NATIVE_ADDRESS && viaReserves1 && viaReserves2 && viaReserves1[0] > 0n);
    
    if (!hasLiquidity && !isWrapOrUnwrap) {
      setSwapError(t("insufficientLiquidity"));
      return;
    }

    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
      const amountIn = parseUnits(fromAmount, 18);
      
      let call;
      
      if (isWrapOrUnwrap) {
        if (fromTokenAddress === NATIVE_ADDRESS) {
          call = {
            address: wUSDC_ADDRESS,
            abi: [{ inputs: [], name: 'deposit', outputs: [], stateMutability: 'payable', type: 'function' }],
            functionName: 'deposit',
            value: amountIn,
          };
        } else {
          call = {
            address: wUSDC_ADDRESS,
            abi: [{ inputs: [{ name: 'amount', type: 'uint256' }], name: 'withdraw', outputs: [], stateMutability: 'nonpayable', type: 'function' }],
            functionName: 'withdraw',
            args: [amountIn],
          };
        }
      } else if (!swapPath || swapPath.length < 2) {
        setSwapError(t("invalidSwapPath"));
        return;
      } else if (isFromNative && !isToNative) {
        call = {
          address: DEX_CONSTANTS.router,
          abi: ROUTER_ABI,
          functionName: 'swapExactETHForTokens',
          args: [minReceive, swapPath, address, deadline],
          value: amountIn,
        };
      } else if (!isFromNative && isToNative) {
        call = {
          address: DEX_CONSTANTS.router,
          abi: ROUTER_ABI,
          functionName: 'swapExactTokensForETH',
          args: [amountIn, minReceive, swapPath, address, deadline],
        };
      } else {
        call = {
          address: DEX_CONSTANTS.router,
          abi: ROUTER_ABI,
          functionName: 'swapExactTokensForTokens',
          args: [amountIn, minReceive, swapPath, address, deadline],
        };
      }

      lastSwapRef.current = {
        fromSymbol: fromToken.symbol,
        toSymbol: toToken.symbol,
        amount: fromAmount,
      };
      await swap(call);
    } catch (err) {
      console.error('Swap error:', err);
      let errorMessage = err?.message || err?.reason || 'Swap failed';
      
      if (errorMessage.includes('INSUFFICIENT_OUTPUT_AMOUNT') || errorMessage.includes('Too little received')) {
        errorMessage = t("slippageError");
      } else if (errorMessage.includes('INSUFFICIENT_LIQUIDITY') || errorMessage.includes('流动性不足')) {
        errorMessage = t("insufficientLiquidity");
      } else if (errorMessage.includes('TransferHelper: TRANSFER_FROM_FAILED')) {
        errorMessage = t("transferError");
      } else if (errorMessage.includes('execution reverted')) {
        errorMessage = t("revertError");
      }
      
      setSwapError(errorMessage.slice(0, 120));
    }
  };

  const handleSwitchTokens = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmount('');
    setSwapError('');
  };

  const handleSetMaxBalance = () => {
    if (displayFromBalance) {
      const maxFormatted = formatUnits(displayFromBalance, 18);
      setFromAmount(parseFloat(maxFormatted).toFixed(6));
    }
  };

  return (
    <main style={{ paddingTop: '100px', paddingBottom: '80px', minHeight: '100vh' }}>
      <div style={{ maxWidth: '420px', margin: '0 auto', padding: '0 1rem' }}>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '20px', padding: '1.5rem', marginBottom: '1rem', boxShadow: '0 8px 32px var(--color-shadow)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h1 style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: '1.75rem', color: 'var(--color-fg)', letterSpacing: '0.02em', margin: 0 }}>
              Swap
            </h1>
            <button onClick={() => setShowSettings(!showSettings)} style={{ padding: '0.5rem', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-fg-muted)', borderRadius: '8px' }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 13C11.6569 13 13 11.6569 13 10C13 8.34315 11.6569 7 10 7C8.34315 7 7 8.34315 7 10C7 11.6569 8.34315 13 10 13Z" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M10 1V3M10 17V19M19 10H17M3 10H1M16.364 3.636L14.95 5.05M5.05 14.95L3.636 16.364M16.364 16.364L14.95 14.95M5.05 5.05L3.636 3.636" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          {showSettings && (
            <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--color-surface-elevated)', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-fg-muted)' }}>{slippageTolerance}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {[0.1, 0.5, 1, 3].map((val) => (
                  <button key={val} onClick={() => setSlippage(val)} style={{ flex: 1, padding: '0.625rem 0.5rem', background: slippage === val ? 'var(--color-accent)' : 'var(--color-surface-hover)', color: slippage === val ? 'var(--color-accent-fg)' : 'var(--color-fg)', border: 'none', borderRadius: '8px', fontSize: '0.8125rem', fontWeight: '600', cursor: 'pointer' }}>
                    {val}%
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '16px', padding: '1rem', marginBottom: '0.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-fg-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t("from")}</span>
              {isConnected && (
                <button onClick={handleSetMaxBalance} style={{ background: 'transparent', border: 'none', color: 'var(--color-accent)', fontSize: '0.6875rem', fontWeight: '600', cursor: 'pointer' }}>
                  {t("balance")}: {displayFromBalance ? formatTokenBalance(displayFromBalance, 18) : '0'}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
              <input
                type="number"
                placeholder="0.0"
                value={fromAmount}
                onChange={(e) => setFromAmount(e.target.value)}
                style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--color-fg)', fontSize: '1.625rem', fontWeight: '600', outline: 'none', fontFamily: 'IBM Plex Mono, monospace', minWidth: 0 }}
              />
              <TokenSelector selectedToken={fromToken} onSelect={setFromToken} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', margin: '-8px 0', position: 'relative', zIndex: 10 }}>
            <button onClick={handleSwitchTokens} style={{ width: '36px', height: '36px', background: 'var(--color-surface-elevated)', border: '3px solid var(--color-surface)', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-fg-muted)' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 10L8 6L12 10M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '16px', padding: '1rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-fg-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t("to")}</span>
              {isConnected && (
                <span style={{ fontSize: '0.6875rem', color: 'var(--color-fg-dim)', fontWeight: '600' }}>
                  {t("balance")}: {displayToBalance ? formatTokenBalance(displayToBalance, 18) : '0'}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
              <span style={{ flex: 1, color: outputAmount ? 'var(--color-fg)' : 'var(--color-fg-dim)', fontSize: '1.625rem', fontWeight: '600', fontFamily: 'IBM Plex Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {outputAmount ? parseFloat(formatUnits(outputAmount, 18)).toFixed(6) : '0.0'}
              </span>
              <TokenSelector selectedToken={toToken} onSelect={setToToken} />
            </div>
          </div>

          {canSwap && (
            <div style={{ background: 'var(--color-surface-elevated)', borderRadius: '12px', padding: '0.875rem 1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-fg-muted)' }}>{t("rate")}</span>
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-fg)', fontFamily: 'IBM Plex Mono, monospace' }}>
                  1 {fromToken.symbol} = {outputAmount && fromAmount ? (parseFloat(formatUnits(outputAmount, 18)) / parseFloat(fromAmount)).toFixed(6) : '--'} {toToken.symbol}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-fg-muted)' }}>{t("priceImpact")}</span>
                <span style={{ fontSize: '0.8125rem', color: priceImpact && priceImpact > 5 ? 'var(--color-danger)' : priceImpact && priceImpact > 1 ? 'var(--color-accent)' : 'var(--color-success)', fontWeight: '600' }}>
                  {priceImpact !== null ? priceImpact.toFixed(2) : '--'}%
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-fg-muted)' }}>{t("minReceived")}</span>
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-fg)', fontFamily: 'IBM Plex Mono, monospace' }}>
                  {minReceive ? parseFloat(formatUnits(minReceive, 18)).toFixed(6) : '--'} {toToken.symbol}
                </span>
              </div>
            </div>
          )}

          {!canSwap && fromAmount && parseFloat(fromAmount) > 0 && !outputAmount && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--color-danger-bg)', borderRadius: '8px', textAlign: 'center' }}>
              <span style={{ color: 'var(--color-danger)', fontSize: '0.8125rem', fontWeight: '500' }}>
                {isSameToken ? t("sameToken") : t("noLiquidity")}
              </span>
            </div>
          )}

          {!isConnected ? (
            <button style={{ width: '100%', padding: '1rem', background: 'var(--color-accent)', color: 'var(--color-accent-fg)', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: '700', textTransform: 'uppercase', cursor: 'pointer' }}>
              {t("connectWallet")}
            </button>
          ) : needsApproval ? (
            <button onClick={handleApprove} disabled={isApproving || pendingApproveHash} style={{ width: '100%', padding: '1rem', background: 'var(--color-accent)', color: 'var(--color-accent-fg)', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: '700', textTransform: 'uppercase', cursor: (isApproving || pendingApproveHash) ? 'not-allowed' : 'pointer', opacity: (isApproving || pendingApproveHash) ? 0.7 : 1 }}>
              {isApproving ? t("approving") : pendingApproveHash ? t("waitingConfirm") : `${t("approve")} ${fromToken.symbol}`}
            </button>
          ) : (
            <button onClick={handleSwap} disabled={isSwapping || !canSwap} style={{ width: '100%', padding: '1rem', background: !canSwap ? 'var(--color-fg-dim)' : 'var(--color-success)', color: 'var(--color-accent-fg)', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: '700', textTransform: 'uppercase', cursor: !canSwap ? 'not-allowed' : 'pointer', opacity: isSwapping ? 0.7 : 1 }}>
              {isSwapping ? t("swapping") : t("swap")}
            </button>
          )}

          {swapError && (
            <div style={{ marginTop: '0.875rem', padding: '0.75rem', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger)', borderRadius: '8px' }}>
              <span style={{ color: 'var(--color-danger)', fontSize: '0.8125rem' }}>{swapError}</span>
            </div>
          )}

          {swapSuccess && (
            <div style={{ marginTop: '0.875rem', padding: '0.75rem', background: 'var(--color-success-bg)', border: '1px solid var(--color-success)', borderRadius: '8px' }}>
              <span style={{ color: 'var(--color-success)', fontSize: '0.8125rem', fontWeight: '600' }}>✓ {t("swapComplete")}</span>
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center' }}>
          <a href="https://app.achswapfi.xyz" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-fg-dim)', fontSize: '0.8125rem', textDecoration: 'underline' }}>
            Powered by Achswap
          </a>
        </div>
      </div>
    </main>
  );
}

export default SwapPage;
