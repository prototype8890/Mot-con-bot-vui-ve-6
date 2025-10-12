import { ethers } from 'ethers';

/**
 * Checks if the WETH liquidity reserve in a pair is within the configured min/max range.
 * This version uses ethers.formatEther for safe conversion from wei.
 *
 * @param {bigint} rReserveWeth - The reserve amount of WETH in the pair, in wei.
 * @param {number} minEth - The minimum required WETH liquidity in ETH.
 * @param {number} maxEth - The maximum allowed WETH liquidity in ETH.
 * @returns {boolean}
 */
export function lpInRange(rReserveWeth, minEth, maxEth) {
  // Use formatEther for safe conversion to avoid precision loss with large numbers.
  const eth = parseFloat(ethers.formatEther(rReserveWeth));
  return eth >= minEth && eth <= maxEth;
}
