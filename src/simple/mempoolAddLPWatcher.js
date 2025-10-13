import { ethers } from 'ethers';
import { IUniswapV2Router, IUniswapV2Factory } from './abi.js';
import { getReservesEth } from './filters.js';

const SEL = { addLiquidityETH: '0xf305d719', addLiquidity: '0xe8e33700' };

const MAX_WAIT_RESERVES_MS = Number(process.env.MAX_WAIT_RESERVES_MS || '30000');
const POLL_RESERVES_MS = Number(process.env.POLL_RESERVES_MS || '300');

function normaliseDexConfig(raw) {
  return raw.map((dex) => ({
    name: dex.name || 'DEX',
    routers: (dex.routers || [dex.router]).map((r) => r.toLowerCase()),
    factory: dex.factory.toLowerCase(),
    slug: dex.slug || 'ethereum',
    explorer: dex.explorer || 'etherscan.io'
  }));
}

export function watchMempoolAddLP({
  provider,
  dexes,
  weth,
  minLpEth,
  maxLpEth,
  onCandidate,
  onInfo
}) {
  const normalizedDexes = normaliseDexConfig(dexes);

  if (!(provider instanceof ethers.WebSocketProvider)) {
    console.log('[mempool] ⚠️  No WebSocket provider - Using FALLBACK mode for multi-DEX');

    const fIface = new ethers.Interface(IUniswapV2Factory);
    const pairCreatedTopic = fIface.getEvent('PairCreated').topicHash;
    const processedMap = new Map();

    for (const dex of normalizedDexes) {
      processedMap.set(dex.factory, new Set());
    }

    const onBlock = async (blockNumber) => {
      for (const dex of normalizedDexes) {
        const processed = processedMap.get(dex.factory);
        try {
          const logs = await provider.getLogs({
            address: dex.factory,
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
                onCandidate({ token, pair, eth: ethNow, dex });
              } else {
                onInfo?.({ type: 'out_of_range', token, pair, lpEth: ethNow, min: minLpEth, max: maxLpEth, dex });
              }
            }
          }
        } catch (error) {
          console.error(`[mempool] Fallback block error @${blockNumber} (${dex.name}):`, error.message);
        }
      }
    };

    provider.on('block', onBlock);
    console.log('[mempool] 🔄 Scanning PairCreated from new blocks (multi-DEX)...');
    return { stop: () => { try { provider.off('block', onBlock); } catch {} } };
  }

  const routers = new Map();
  for (const dex of normalizedDexes) {
    for (const router of dex.routers) {
      routers.set(router, dex);
    }
  }

  const rIface = new ethers.Interface(IUniswapV2Router);
  const fIface = new ethers.Interface(IUniswapV2Factory);
  const pairCreatedTopic = fIface.getEvent('PairCreated').topicHash;

  const pending = new Map();
  const processed = new Map();
  for (const dex of normalizedDexes) {
    pending.set(dex.factory, new Map());
    processed.set(dex.factory, new Set());
  }

  const onPending = async (hash) => {
    try {
      const tx = await provider.getTransaction(hash);
      if (!tx || !tx.to) return;
      const to = tx.to.toLowerCase();
      const dex = routers.get(to);
      if (!dex) return;

      const sel = (tx.data || '0x').slice(0, 10);
      if (sel !== SEL.addLiquidityETH && sel !== SEL.addLiquidity) return;

      let token = null;
      let ethFloat = 0;

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
      const processedSet = processed.get(dex.factory);
      if (processedSet.has(tokenLower)) return;

      pending.get(dex.factory).set(tokenLower, { eth: ethFloat, timestamp: Date.now() });

      setTimeout(() => {
        const dexPending = pending.get(dex.factory);
        if (dexPending?.has(tokenLower) && !processedSet.has(tokenLower)) {
          dexPending.delete(tokenLower);
        }
      }, 120000);
    } catch (error) {
      console.error('[mempool] Error in onPending:', error.message);
    }
  };

  provider.on('pending', onPending);
  console.log('[mempool] 👂 Listening to pending transactions (multi-DEX)...');

  const subscriptions = [];

  for (const dex of normalizedDexes) {
    const processedSet = processed.get(dex.factory);
    const dexPending = pending.get(dex.factory);
    const filter = { address: dex.factory, topics: [pairCreatedTopic] };

    const handler = async (log) => {
      try {
        const { args } = fIface.parseLog(log);
        const [t0, t1, pair] = [args[0], args[1], args[2]];
        const token =
          t0.toLowerCase() === weth.toLowerCase() ? t1.toLowerCase() :
          t1.toLowerCase() === weth.toLowerCase() ? t0.toLowerCase() : null;
        if (!token) return;

        const tokenLower = token.toLowerCase();
        if (processedSet.has(tokenLower)) return;

        const start = Date.now();
        while (Date.now() - start < MAX_WAIT_RESERVES_MS) {
          if (processedSet.has(tokenLower)) return;
          try {
            const { ethReserve } = await getReservesEth({ provider, pair, weth });
            const ethNow = Number(ethers.formatEther(ethReserve));

            if (ethNow > 0) {
              processedSet.add(tokenLower);
              dexPending.delete(tokenLower);
              if (ethNow >= minLpEth && ethNow <= maxLpEth) {
                onCandidate({ token: tokenLower, pair, eth: ethNow, dex });
              } else {
                onInfo?.({ type: 'out_of_range', token: tokenLower, pair, lpEth: ethNow, min: minLpEth, max: maxLpEth, dex });
              }
              return;
            }
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, POLL_RESERVES_MS));
        }

        processedSet.add(tokenLower);
        dexPending.delete(tokenLower);
        onInfo?.({ type: 'mint_timeout', token: tokenLower, pair, dex });
      } catch (error) {
        console.error('[mempool] Error in PairCreated handler:', error.message);
      }
    };

    provider.on(filter, handler);
    subscriptions.push({ filter, handler });
  }

  return {
    stop: () => {
      try {
        provider.off('pending', onPending);
        for (const sub of subscriptions) {
          provider.off(sub.filter, sub.handler);
        }
      } catch {}
    }
  };
}

