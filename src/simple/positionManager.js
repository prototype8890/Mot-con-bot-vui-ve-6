
import { ethers } from 'ethers';
import { priceTokensForEth } from './pricing.js';
import { sellAll } from './sell.js';

export function managePosition({ provider, wallet, router, weth, token, buyWeiCost, buyTokenAmount, buyTs, tpPct=20, timeoutSec=600, notifier }){
  const addrP = wallet.getAddress();
  const loop = setInterval(async ()=>{
    try{
      const addr = await addrP;
      const bal = await (new ethers.Contract(token, ['function balanceOf(address) view returns (uint256)'], provider)).balanceOf(addr);
      if (bal === 0n) { clearInterval(loop); return; }

      const outWei = await priceTokensForEth({ provider, router, token, weth, amountIn: bal });
      if (outWei === 0n) return;

      const pnlPct = Number((outWei - buyWeiCost) * 10000n // bps
                            // Avoid negative BigInt division by check
                           ) / Number(buyWeiCost) / 100;
      const age = Math.floor(Date.now()/1000) - buyTs;
      if (pnlPct >= tpPct || age >= timeoutSec){
        notifier?.send?.(`[SELL] reason=${pnlPct>=tpPct?'TP':'TIMEOUT'} pnlPct=${pnlPct.toFixed(2)} age=${age}s`);
        const { sold, hash, reason } = await sellAll({ router, token, weth, wallet });
        notifier?.send?.(sold ? `[SELL.TX] ${hash}` : `[SELL.FAIL] ${reason||'unknown'}`);
        clearInterval(loop);
      }
    }catch(e){
      notifier?.send?.(`[POSITION.ERROR] ${e?.message||e}`);
    }
  }, 2000);
  return { stop: ()=>clearInterval(loop) };
}
