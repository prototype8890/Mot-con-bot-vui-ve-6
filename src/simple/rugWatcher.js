
import { ethers } from 'ethers';

const SELECTORS = {
  removeLiquidity: [
    '0x02751cec','0xa38d2f7a','0xbaa2abde','0x5b0d5984','0x2195995c','0x7acbcdce',
    '0x0c49ccbe','0x1249c58b','0x02e95b6c','0x5c11d795','0x8a8c523c'
  ],
  burn: '0x42966c68'
};

export function watchRugDefense({ provider, pair, routers, thresholdBp=2000, onThreat }){
  if (!(provider instanceof ethers.WebSocketProvider)) return { stop: ()=>{} };
  const routerSet = new Set(routers.map(x=>x.toLowerCase()));
  const routerIface = new ethers.Interface([
    'function removeLiquidity(address,address,uint,uint,uint,address,uint)',
    'function removeLiquidityETH(address,uint,uint,uint,address,uint)',
    'function removeLiquidityWithPermit(address,address,uint,uint,uint,address,uint,bool,uint8,bytes32,bytes32)',
    'function removeLiquidityETHWithPermit(address,uint,uint,uint,address,uint,bool,uint8,bytes32,bytes32)'
  ]);
  const pairIface = new ethers.Interface(['function totalSupply() view returns (uint256)']);

  const handler = async (hash) => {
    try{
      const tx = await provider.getTransaction(hash);
      if (!tx) return;
      const to = (tx.to||'').toLowerCase();
      const sel = (tx.data||'0x').slice(0,10);

      if (routerSet.has(to) && SELECTORS.removeLiquidity.includes(sel)){
        const parsed = routerIface.parseTransaction({ data: tx.data });
        const liquidity = parsed?.args?.find(a => typeof a === 'bigint') ?? 0n;
        if (liquidity > 0n){
          const rawTs = await provider.call({ to: pair, data: pairIface.encodeFunctionData('totalSupply',[]) });
          const [ts] = pairIface.decodeFunctionResult('totalSupply', rawTs);
          const bp = Number((liquidity * 10000n) / BigInt(ts || 1n));
          if (bp >= thresholdBp) await onThreat({ kind:'router-remove', hash, rivalTip: tx.maxPriorityFeePerGas||0n });
        }
        return;
      }
      if (to === pair.toLowerCase() && sel===SELECTORS.burn){
        await onThreat({ kind:'pair-burn', hash, rivalTip: tx.maxPriorityFeePerGas||0n });
      }
    }catch{}
  };
  provider.on('pending', handler);
  return { stop: ()=>{ try{ provider.off('pending', handler);}catch{} } };
}
