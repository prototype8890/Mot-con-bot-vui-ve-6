import { IUniswapV2Router } from './exchange/uniswapV2.js';

/**
 * Simulate buy then sell on router. Throws if any step reverts.
 */
export async function simulateBuySell({ provider, router, weth, token, amountInWei, wallet }) {
  const pathBuy = [weth, token];
  const dataOut = IUniswapV2Router.encodeFunctionData('getAmountsOut', [amountInWei, pathBuy]);
  const amounts = await provider.call({ to: router, data: dataOut }).catch(()=>null);
  if (!amounts) throw new Error('simulate: getAmountsOut failed');
  const decoded = IUniswapV2Router.decodeFunctionResult('getAmountsOut', amounts)[0];
  const amountOutBuy = decoded[decoded.length-1];

  // simulate swapExactETHForTokens
  const deadline = Math.floor(Date.now()/1000)+300;
  const txBuyData = IUniswapV2Router.encodeFunctionData('swapExactETHForTokens', [0, pathBuy, wallet, deadline]);
  await provider.call({ to: router, from: wallet, data: txBuyData, value: amountInWei }).catch(()=>{ throw new Error('simulate: buy revert'); });

  // simulate sell quote
  const pathSell = [token, weth];
  const dataOut2 = IUniswapV2Router.encodeFunctionData('getAmountsOut', [amountOutBuy, pathSell]);
  const amounts2 = await provider.call({ to: router, data: dataOut2 }).catch(()=>null);
  if (!amounts2) throw new Error('simulate: sell quote failed');
  const decoded2 = IUniswapV2Router.decodeFunctionResult('getAmountsOut', amounts2)[0];
  const amountOutSell = decoded2[decoded2.length-1];
  if (amountOutSell === 0n) throw new Error('simulate: sell would be zero');

  return { amountOutBuy, amountOutSell };
}
