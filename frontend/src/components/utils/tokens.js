import { parseEther, formatEther, parseUnits, formatUnits } from 'viem';

export const DEX_CONSTANTS = {
  factory: '0x7cC023C7184810B84657D55c1943eBfF8603B72B',
  router: '0xB92428D440c335546b69138F7fAF689F5ba8D436',
};

export const TOKEN_ADDRESSES = {
  USDC: '0x0000000000000000000000000000000000000000',
  wUSDC: '0xDe5DB9049a8dd344dC1B7Bbb098f9da60930A6dA',
  APD: '0x5A7BF3fFc172Ee0867415e1d14c62eCbA2cCccDD',
};

export const TOKENS = {
  USDC: {
    address: TOKEN_ADDRESSES.USDC,
    symbol: 'USDC',
    name: 'USD Coin (Native)',
    decimals: 18,
    logo: '/logos/usdc.png',
    isNative: true,
  },
  wUSDC: {
    address: TOKEN_ADDRESSES.wUSDC,
    symbol: 'wUSDC',
    name: 'Wrapped USDC',
    decimals: 18,
    logo: '/logos/wusdc.png',
    isNative: false,
  },
  APD: {
    address: TOKEN_ADDRESSES.APD,
    symbol: 'APD',
    name: 'APD Token',
    decimals: 18,
    logo: '/logos/apd.png',
    isNative: false,
  },
};

export const DEFAULT_TOKEN_LIST = [
  TOKENS.USDC,
  TOKENS.wUSDC,
  TOKENS.APD,
];

export const ROUTER_ABI = [
  {
    inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'path', type: 'address[]' }],
    name: 'getAmountsOut',
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'path', type: 'address[]' }],
    name: 'getAmountsIn',
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'WETH',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    name: 'swapExactTokensForTokens',
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    name: 'swapExactETHForTokens',
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    name: 'swapExactTokensForETH',
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

export const ERC20_ABI = [
  { inputs: [], name: 'name', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ name: '', type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'owner', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], name: 'allowance', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
];

export const WRAPPED_TOKEN_ABI = [
  { inputs: [], name: 'deposit', outputs: [], stateMutability: 'payable', type: 'function' },
  { inputs: [{ name: 'amount', type: 'uint256' }], name: 'withdraw', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], name: 'allowance', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
];

export function parseTokenAmount(amount, decimals = 18) {
  if (!amount || amount === '') return 0n;
  return parseUnits(amount, decimals);
}

export function formatTokenAmount(amount, decimals = 18) {
  if (!amount) return '0';
  return formatUnits(amount, decimals);
}

export function formatTokenBalance(balance, decimals = 18) {
  const formatted = formatTokenAmount(balance, decimals);
  const num = parseFloat(formatted);
  if (num === 0) return '0';
  if (num < 0.0001) return '< 0.0001';
  if (num < 1) return num.toPrecision(4);
  if (num < 1000) return num.toFixed(4);
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
  return num.toFixed(2);
}
