import { ethers } from 'ethers';
import { getReserves, getTokens, priceQuoteFromReserves } from './utils.js';

export async function snapshotP0(provider, pair, base, quote){
  const { reserve0, reserve1 } = await getReserves(provider, pair);
  const { token0, token1 } = await getTokens(provider, pair);
  const p0 = priceQuoteFromReserves({ reserve0, reserve1, token0, token1, base: base.toLowerCase(), quote: quote.toLowerCase() });
  return p0;
}

export async function currentPrice(provider, pair, base, quote){
  return snapshotP0(provider, pair, base, quote);
}

export function aboveMultiple(pNow, p0, multiple){
  // multiple is e.g. 3 -> 3x
  return pNow * 1n >= p0 * BigInt(Math.floor(multiple*1e6)) / 1_000_000n;
}
