/**
 * Calculates dynamic gas fees based on the base fee and historical priority fees.
 * This version uses historical rewards (priority fees) for a more accurate priority fee estimation.
 *
 * @param {bigint} baseFeeWei - The current block's base fee in wei.
 * @param {bigint[]} history - An array of recent priority fees (rewards) in wei.
 * @returns {{maxFeePerGas: bigint, maxPriorityFeePerGas: bigint}}
 */
export function dynamicGas(baseFeeWei, history) {
  const base = BigInt(baseFeeWei || 0);
  
  let priorityFee;
  if (history.length > 0) {
    const sortedHistory = [...history].sort((a, b) => a > b ? 1 : -1);
    priorityFee = sortedHistory[Math.floor(sortedHistory.length / 2)]; // Median
  } else {
    priorityFee = 1_500_000_000n; // Default to 1.5 gwei if no history
  }

  // Add a small buffer to the priority fee
  const bufferedPriorityFee = priorityFee + (priorityFee / 4n); // Add 25%

  const maxPriorityFeePerGas = bufferedPriorityFee;
  
  // Max fee is the base fee plus the priority fee, doubling base fee to handle spikes.
  const maxFeePerGas = (base * 2n) + maxPriorityFeePerGas;

  return { maxFeePerGas, maxPriorityFeePerGas };
}
