export function calcMinOut(amountOut, maxSlippageBps) {
  return amountOut * BigInt(10_000 - maxSlippageBps) / 10_000n;
}
