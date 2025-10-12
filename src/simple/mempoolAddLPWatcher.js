// src/simple/mempoolAddLPWatcher.js
import { ethers } from 'ethers';
import { IUniswapV2Router, IUniswapV2Factory, IUniswapV2Pair } from './abi.js';
import { getReservesEth } from './filters.js';

const SEL = { addLiquidityETH: '0xf305d719', addLiquidity: '0xe8e33700' };

// ENV controls
const MAX_WAIT_RESERVES_MS = Number(process.env.MAX_WAIT_RESERVES_MS || '30000'); // 30s
const POLL_RESERVES_MS     = Number(process.env.POLL_RESERVES_MS || '300');      // 300ms

export function watchMempoolAddLP({
  provider, routerList, factory, weth,
  minLpEth, maxLpEth,
  onCandidate, onInfo
}) {
  // ────────────────────────────────────────────────────────────────────────────
  // FALLBACK (no WSS): scan PairCreated per block, then read reserves directly
  // ────────────────────────────────────────────────────────────────────────────
  if (!(provider instanceof ethers.WebSocketProvider)) {
    console.log('[mempool] ⚠️  No WebSocket provider - Using FALLBACK mode');
    const fIface = new ethers.Interface(IUniswapV2Factory);
    const pairCreatedTopic = fIface.getEvent('PairCreated').topicHash;
    const processed = new Set();

    const onBlock = async (blockNumber) => {
      try {
        const logs = await provider.getLogs({
          address: factory,
          topics: [pairCreatedTopic],
          fromBlock: blockNumber,
          toBlock: blockNumber
        });
        for (const log of logs) {
          const { args } = fIface.parseLog(log);
          const [t0, t1, pair] = [args[0], args[1], args[2]];
          const token =
            t0.toLowerCase() === weth.toLowerCase() ? t1.toLowerCase() :
            t1.toLowerCase() === weth.toLowerCase() ? t0.toLowerCase() : null;
          if (!token) continue;
          if (processed.has(token)) continue;

          const { ethReserve } = await getReservesEth({ provider, pair, weth });
          const ethNow = Number(ethers.formatEther(ethReserve));

          if (ethNow > 0) {
            processed.add(token);
            if (ethNow >= minLpEth && ethNow <= maxLpEth) {
              console.log(`[mempool] ✅ Found pair in block ${blockNumber}: LP=${ethNow}ETH`);
              onCandidate({ token, pair, eth: ethNow });
            } else {
              console.log(`[mempool] ⏭️  Out of range: ${ethNow}ETH (need ${minLpEth}-${maxLpEth})`);
              try { onInfo?.({ type: 'out_of_range', token, pair, lpEth: ethNow, min: minLpEth, max: maxLpEth }); } catch {}
            }
          }
        }
      } catch (e) {
        console.error(`[mempool] Fallback block error @${blockNumber}:`, e.message);
      }
    };

    provider.on('block', onBlock);
    console.log('[mempool] 🔄 Scanning PairCreated from new blocks...');
    return { stop: () => { try { provider.off('block', onBlock); } catch {} } };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // WSS MODE
  // ────────────────────────────────────────────────────────────────────────────
  const routers = new Set(routerList.map(a => a.toLowerCase()));
  const rIface = new ethers.Interface(IUniswapV2Router);
  const fIface = new ethers.Interface(IUniswapV2Factory);
  const pairCreated = fIface.getEvent('PairCreated').topicHash;

  const pending = new Map();   // tokenLower -> {eth, timestamp}
  const processed = new Set(); // tokenLower

  // Listen pending AddLP
  const onPending = async (hash) => {
    try {
      const tx = await provider.getTransaction(hash);
      if (!tx || !tx.to) return;
      const to = tx.to.toLowerCase();
      if (!routers.has(to)) return;

      const sel = (tx.data || '0x').slice(0, 10);
      if (sel !== SEL.addLiquidityETH && sel !== SEL.addLiquidity) return;

      let token = null, ethFloat = 0;

      if (sel === SEL.addLiquidityETH) {
        const parsed = rIface.parseTransaction({ data: tx.data });
        if (!parsed || !parsed.args) return;
        token = parsed.args[0];
        ethFloat = Number(ethers.formatEther(tx.value || 0n));
      } else {
        const parsed = rIface.parseTransaction({ data: tx.data });
        if (!parsed || !parsed.args) return;
        const [a, b, aDesired, bDesired] = [parsed.args[0], parsed.args[1], parsed.args[2], parsed.args[3]];
        if (a.toLowerCase() === weth.toLowerCase()) ethFloat = Number(ethers.formatEther(aDesired));
        if (b.toLowerCase() === weth.toLowerCase()) ethFloat = Number(ethers.formatEther(bDesired));
        token =
          a.toLowerCase() === weth.toLowerCase() ? b :
          (b.toLowerCase() === weth.toLowerCase() ? a : null);
      }

      if (!token) return;
      if (ethFloat < minLpEth || ethFloat > maxLpEth) return;

      const tokenLower = token.toLowerCase();
      if (processed.has(tokenLower)) return;

      pending.set(tokenLower, { eth: ethFloat, timestamp: Date.now() });
      console.log(`[mempool] 👀 Detected AddLP pending: ${tokenLower.slice(0,10)}... LP≈${ethFloat}ETH`);

      // GC pending after 2 minutes
      setTimeout(() => {
        if (pending.has(tokenLower) && !processed.has(tokenLower)) {
          pending.delete(tokenLower);
          console.log(`[mempool] 🧹 Timeout cleaning: ${tokenLower.slice(0,10)}...`);
        }
      }, 120000);
    } catch (e) {
      console.error('[mempool] Error in onPending:', e.message);
    }
  };

  provider.on('pending', onPending);
  console.log('[mempool] 👂 Listening to pending transactions...');

  // PairCreated → poll reserves (do not wait for Mint)
  const pairFilter = { address: factory, topics: [pairCreated] };

  const onPair = async (log) => {
    try {
      const { args } = fIface.parseLog(log);
      const [t0, t1, pair] = [args[0], args[1], args[2]];
      const token =
        t0.toLowerCase() === weth.toLowerCase() ? t1.toLowerCase() :
        t1.toLowerCase() === weth.toLowerCase() ? t0.toLowerCase() : null;
      if (!token) return;

      const tokenLower = token.toLowerCase();
      if (processed.has(tokenLower)) {
        console.log(`[mempool] ⭕️ Already processed: ${tokenLower.slice(0,10)}...`);
        return;
      }

      console.log(`[mempool] 🎯 PairCreated detected: ${tokenLower.slice(0,10)}... pair=${pair.slice(0,10)}...`);

      // Poll reserves until ready or timeout
      const start = Date.now();
      while (Date.now() - start < MAX_WAIT_RESERVES_MS) {
        if (processed.has(tokenLower)) return; // handled elsewhere
        try {
          const { ethReserve } = await getReservesEth({ provider, pair, weth });
          const ethNow = Number(ethers.formatEther(ethReserve));

          if (ethNow > 0) {
            if (ethNow >= minLpEth && ethNow <= maxLpEth) {
              processed.add(tokenLower);
              pending.delete(tokenLower);
              console.log(`[mempool] ✅ Reserves ready: LP=${ethNow}ETH`);
              onCandidate({ token: tokenLower, pair, eth: ethNow });
              return;
            } else {
              console.log(`[mempool] ⏭️  Out of range: ${ethNow}ETH (need ${minLpEth}-${maxLpEth})`);
              processed.add(tokenLower);
              pending.delete(tokenLower);
              try { onInfo?.({ type: 'out_of_range', token: tokenLower, pair, lpEth: ethNow, min: minLpEth, max: maxLpEth }); } catch {}
              return;
            }
          }
        } catch { /* keep polling */ }
        await new Promise(r => setTimeout(r, POLL_RESERVES_MS));
      }

      // Timeout
      console.log(`[mempool] ⏰ Timeout: No liquidity after ${Math.floor(MAX_WAIT_RESERVES_MS/1000)}s for ${tokenLower.slice(0,10)}...`);
      processed.add(tokenLower);
      pending.delete(tokenLower);
      try { onInfo?.({ type: 'mint_timeout', token: tokenLower, pair }); } catch {}
    } catch (e) {
      console.error('[mempool] Error in PairCreated handler:', e.message);
    }
  };

  provider.on(pairFilter, onPair);
  console.log('[mempool] 👂 Listening to PairCreated events...');

  return {
    stop: () => {
      try {
        provider.off('pending', onPending);
        provider.off(pairFilter, onPair);
        console.log('[mempool] 🛑 Stopped listening');
      } catch {}
    }
  };
}
