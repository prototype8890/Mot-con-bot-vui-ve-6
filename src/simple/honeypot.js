import { ethers } from 'ethers';
import { IERC20, IUniswapV2Pair, IUniswapV2Router } from './abi.js';

export async function runHoneypotChecks({ provider, token, pair, router, weth, minLiquidityRatio = 0.02 }) {
  const reasons = [];
  let suspicious = false;

  try {
    const tokenContract = new ethers.Contract(token, IERC20, provider);
    const pairContract = new ethers.Contract(pair, IUniswapV2Pair, provider);

    const [totalSupply, pairBalance, reserves, token0] = await Promise.all([
      tokenContract.totalSupply().catch(() => 0n),
      tokenContract.balanceOf(pair).catch(() => 0n),
      pairContract.getReserves().catch(() => [0n, 0n]),
      pairContract.token0().catch(() => ethers.ZeroAddress)
    ]);

    const wethReserve = token0.toLowerCase() === weth.toLowerCase() ? reserves[0] : reserves[1];
    const tokenReserve = token0.toLowerCase() === weth.toLowerCase() ? reserves[1] : reserves[0];

    if (totalSupply > 0n) {
      const liquidityRatio = Number(pairBalance) / Number(totalSupply || 1n);
      if (liquidityRatio < minLiquidityRatio) {
        suspicious = true;
        reasons.push(`LP holds only ${(liquidityRatio * 100).toFixed(2)}% of supply`);
      }
    }

    if (wethReserve === 0n || tokenReserve === 0n) {
      suspicious = true;
      reasons.push('Pair reserves empty or zero');
    }

    const routerContract = new ethers.Contract(router, IUniswapV2Router, provider);
    try {
      const amounts = await routerContract.getAmountsOut(ethers.parseEther('0.05'), [weth, token]);
      if (!amounts || amounts.length < 2 || amounts[1] === 0n) {
        suspicious = true;
        reasons.push('Router getAmountsOut returned zero output');
      }
    } catch (error) {
      suspicious = true;
      reasons.push(`getAmountsOut failed: ${error.shortMessage || error.message}`);
    }

    try {
      const amountsIn = await routerContract.getAmountsIn(ethers.parseUnits('100000', 18), [token, weth]);
      if (!amountsIn || amountsIn.length < 2) {
        suspicious = true;
        reasons.push('Router getAmountsIn returned invalid response');
      }
    } catch (error) {
      suspicious = true;
      reasons.push(`getAmountsIn failed: ${error.shortMessage || error.message}`);
    }
  } catch (error) {
    suspicious = true;
    reasons.push(`Honeypot checks error: ${error.message}`);
  }

  return { suspicious, reasons };
}

