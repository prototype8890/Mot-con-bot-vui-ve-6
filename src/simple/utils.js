import { ethers } from 'ethers';
import { IUniswapV2Pair } from './abi.js';

export async function getReserves(provider, pair){
  const iface = new ethers.Interface(IUniswapV2Pair);
  const data = iface.encodeFunctionData('getReserves', []);
  const raw = await provider.call({ to: pair, data });
  const [r0, r1] = iface.decodeFunctionResult('getReserves', raw);
  return { reserve0: BigInt(r0), reserve1: BigInt(r1) };
}

export async function getTokens(provider, pair){
  const iface = new ethers.Interface(IUniswapV2Pair);
  const t0 = await provider.call({ to: pair, data: iface.encodeFunctionData('token0',[]) });
  const t1 = await provider.call({ to: pair, data: iface.encodeFunctionData('token1',[]) });
  const [token0] = iface.decodeFunctionResult('token0', t0);
  const [token1] = iface.decodeFunctionResult('token1', t1);
  return { token0: token0.toLowerCase(), token1: token1.toLowerCase() };
}

export function priceQuoteFromReserves({ reserve0, reserve1, token0, token1, base, quote }){
  const Q = 10n**18n;
  // price = quote per base
  if (base===token0 && quote===token1){
    if (reserve0===0n) return 0n;
    return (reserve1*Q)/reserve0;
  }
  if (base===token1 && quote===token0){
    if (reserve1===0n) return 0n;
    return (reserve0*Q)/reserve1;
  }
  throw new Error('pair tokens mismatch');
}

export function gwei(n){ return ethers.parseUnits(String(n),'gwei'); }
