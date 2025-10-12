import { snapshotP0, currentPrice } from './priceGuard.js';

export function runTpWatcher({ provider, pair, base, quote, entryPrice, tpPct=20, onTp }){
  const target = entryPrice + (entryPrice * BigInt(Math.floor(tpPct*100)))/10000n; // tpPct%
  let stopped=false;
  async function onBlock(){
    if (stopped) return;
    const p = await currentPrice(provider, pair, base, quote);
    if (p>=target){
      stopped=true;
      await onTp(p);
    }
  }
  provider.on('block', async ()=> { try{ await onBlock(); }catch{} });
  return { stop: ()=>{ stopped=true; } };
}
