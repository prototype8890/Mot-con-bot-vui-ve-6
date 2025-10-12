import { ethers } from 'ethers';

export const IUniswapV2Pair = new ethers.Interface([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)'
]);

export const IUniswapV2Router = new ethers.Interface([
  'function getAmountsOut(uint amountIn, address[] calldata path) view returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)'
]);

export async function readReserves(provider, pair) {
  const data = IUniswapV2Pair.encodeFunctionData('getReserves', []);
  const raw = await provider.call({ to: pair, data });
  const [r0, r1] = IUniswapV2Pair.decodeFunctionResult('getReserves', raw);
  return [r0, r1];
}

export function pickWethReserve({ token0, token1, reserve0, reserve1, weth }) {
  if (token0.toLowerCase() === weth.toLowerCase()) return reserve0;
  if (token1.toLowerCase() === weth.toLowerCase()) return reserve1;
  return 0n;
}
