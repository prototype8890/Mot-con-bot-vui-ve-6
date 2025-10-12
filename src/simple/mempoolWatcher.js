import { ethers } from 'ethers';
import { SELECTORS } from './abi.js';
import { gwei } from './utils.js';

export function watchRug({ provider, pair, routers, thresholdBp=2000, onThreat }){
  const routerSet = new Set(routers.map(x=>x.toLowerCase()));
  provider.on('pending', async (hash) => {
    try{
      const tx = await provider.getTransaction(hash);
      if (!tx) return;
      const to = (tx.to||'').toLowerCase();

      // Path 1: Router removeLiquidity*
      if (routerSet.has(to)) {
        const sel = (tx.data||'0x').slice(0,10);
        if (SELECTORS.removeLiquidity.includes(sel)){
          // Liquidity amount is tx.args[2] usually, but robust decode needs ABI.
          // We fallback to threat signal without exact % to avoid heavy decode here.
          await onThreat({ rivalTip: tx.maxPriorityFeePerGas||0n, kind:'router-remove', hash });
          return;
        }
      }
      // Path 2: Pair.burn(address)
      if (to === pair.toLowerCase() && (tx.data||'').slice(0,10)===SELECTORS.burn){
        await onThreat({ rivalTip: tx.maxPriorityFeePerGas||0n, kind:'pair-burn', hash });
        return;
      }
    }catch{}
  });
}
