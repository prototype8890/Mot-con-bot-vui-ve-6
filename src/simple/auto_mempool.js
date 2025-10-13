import 'dotenv/config';
import { ethers } from 'ethers';
import TelegramBot from 'node-telegram-bot-api';
import { watchMempoolAddLP } from './mempoolAddLPWatcher.js';
import { enforceStrictTax, rejectBySelectors, basePriceTokensPerEth } from './filters.js';
import { createRobustProvider } from './providerSelector.js';
import { EnhancedNotifier, calculateGasCost } from './enhancedNotifier.js';
import { BananaGunClient } from './bananaGunClient.js';
import { IUniswapV2Pair, IERC20 } from './abi.js';
import { watchRugDefense } from './rugWatcher.js';

function cfg() {
  const e = process.env;
  if (!e.RPC_URLS) throw new Error('❌ RPC_URLS missing');

  const bananaGun = (() => {
    const enabled = Boolean(
      e.BANANA_GUN_TG_API_ID &&
      e.BANANA_GUN_TG_API_HASH &&
      e.BANANA_GUN_TG_SESSION &&
      e.BANANA_GUN_BUY_AMOUNT_ETH
    );

    if (!enabled) {
      return { enabled: false };
    }

    const apiId = Number(e.BANANA_GUN_TG_API_ID);
    if (!Number.isInteger(apiId) || apiId <= 0) {
      throw new Error('❌ BANANA_GUN_TG_API_ID phải là số nguyên dương');
    }

    const apiHash = e.BANANA_GUN_TG_API_HASH.trim();
    if (!apiHash) {
      throw new Error('❌ BANANA_GUN_TG_API_HASH không được để trống');
    }

    const session = e.BANANA_GUN_TG_SESSION.trim();
    if (!session) {
      throw new Error('❌ BANANA_GUN_TG_SESSION không được để trống');
    }

    let amountWei;
    try {
      amountWei = ethers.parseEther(e.BANANA_GUN_BUY_AMOUNT_ETH);
    } catch (err) {
      throw new Error(`❌ BANANA_GUN_BUY_AMOUNT_ETH không hợp lệ: ${err.message}`);
    }

    if (amountWei <= 0n) {
      throw new Error('❌ BANANA_GUN_BUY_AMOUNT_ETH phải > 0');
    }

    const slippageBps = Number(e.BANANA_GUN_SLIPPAGE_BPS || '500');
    if (!Number.isFinite(slippageBps) || slippageBps <= 0) {
      throw new Error('❌ BANANA_GUN_SLIPPAGE_BPS phải là số > 0');
    }

    const priorityFeeGwei = Number(e.BANANA_GUN_PRIORITY_FEE_GWEI || '3');
    if (!Number.isFinite(priorityFeeGwei) || priorityFeeGwei < 0) {
      throw new Error('❌ BANANA_GUN_PRIORITY_FEE_GWEI phải là số ≥ 0');
    }

    const gasMultiplier = Number(e.BANANA_GUN_GAS_MULTIPLIER || '1.2');
    if (!Number.isFinite(gasMultiplier) || gasMultiplier <= 0) {
      throw new Error('❌ BANANA_GUN_GAS_MULTIPLIER phải là số > 0');
    }

    const sellPercent = Number(e.BANANA_GUN_SELL_PERCENT || '100');
    if (!Number.isFinite(sellPercent) || sellPercent <= 0 || sellPercent > 100) {
      throw new Error('❌ BANANA_GUN_SELL_PERCENT phải nằm trong khoảng 1-100');
    }

    const buyTemplate = e.BANANA_GUN_TG_BUY_TEMPLATE?.trim() || '/buy {token} {amount} {slippageBps} {priorityFeeGwei}';
    const sellTemplate = e.BANANA_GUN_TG_SELL_TEMPLATE?.trim() || '/sell {token} {percent}';
    const botUsername = e.BANANA_GUN_TG_BOT?.trim() || '@BananaGunBot';
    const responseTimeoutMs = Number(e.BANANA_GUN_TG_RESPONSE_TIMEOUT_MS || '20000');
    const walletAddress = e.BANANA_GUN_WALLET_ADDRESS?.toLowerCase() || null;

    return {
      enabled: true,
      apiId,
      apiHash,
      session,
      botUsername,
      buyTemplate,
      sellTemplate,
      responseTimeoutMs: Number.isFinite(responseTimeoutMs) && responseTimeoutMs > 0 ? responseTimeoutMs : 20000,
      amountWei,
      amountEthDisplay: e.BANANA_GUN_BUY_AMOUNT_ETH,
      slippageBps,
      priorityFeeGwei,
      gasMultiplier,
      sellPercent,
      walletAddress
    };
  })();

  const timeoutMinutes = Number(e.AUTO_SELL_TIMEOUT_MINUTES || '10');
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    throw new Error('❌ AUTO_SELL_TIMEOUT_MINUTES phải > 0');
  }

  const rugThresholdBps = Number(e.RUG_PULL_THRESHOLD_BPS || '500');
  if (!Number.isFinite(rugThresholdBps) || rugThresholdBps <= 0) {
    throw new Error('❌ RUG_PULL_THRESHOLD_BPS phải > 0');
  }

  return {
    rpcUrls: e.RPC_URLS,
    weth: (e.WETH || '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2').toLowerCase(),
    router: e.ROUTER_V2 || '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    factory: e.FACTORY_V2 || '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    minLP: Number(e.MIN_LP_ETH || '0.5'),
    maxLP: Number(e.MAX_LP_ETH || '1'),
    taxMax: Number(e.STRICT_TAX_BPS_MAX || '0'),
    taxMode: e.STRICT_TAX_MODE || 'reject_unknown',
    blocked: e.BLOCKLIST_SELECTORS || '',
    priceGuard: Number(e.PRICE_GUARD || '1') === 1,
    priceMultipleAbort: Number(e.PRICE_MULTIPLE_ABORT || '3'),
    tgToken: e.TELEGRAM_TOKEN || e.TELEGRAM_BOT_TOKEN || '',
    tgChat: e.TELEGRAM_CHAT_ID || '',
    bananaGun,
    timeoutMs: timeoutMinutes * 60 * 1000,
    rugThresholdBps
  };
}

const pairInterface = new ethers.Interface(IUniswapV2Pair);
const swapTopic = pairInterface.getEventTopic('Swap');
const pairInfoCache = new Map();
const tokenMetaCache = new Map();
const creationCache = new Map();

async function getTokenMetadata(provider, token) {
  const key = token.toLowerCase();
  if (tokenMetaCache.has(key)) return tokenMetaCache.get(key);

  const fallback = { symbol: null, name: null, decimals: 18 };

  try {
    const erc = new ethers.Contract(token, IERC20, provider);
    const [symbol, name, decimals] = await Promise.all([
      erc.symbol().catch(() => null),
      erc.name().catch(() => null),
      erc.decimals().catch(() => 18)
    ]);

    const meta = {
      symbol: symbol || null,
      name: name || null,
      decimals: Number(decimals) || 18
    };
    tokenMetaCache.set(key, meta);
    return meta;
  } catch {
    tokenMetaCache.set(key, fallback);
    return fallback;
  }
}

async function getPairInfo(provider, pair) {
  const key = pair.toLowerCase();
  if (pairInfoCache.has(key)) return pairInfoCache.get(key);

  const contract = new ethers.Contract(pair, IUniswapV2Pair, provider);
  const [token0, token1] = await Promise.all([
    contract.token0(),
    contract.token1()
  ]);

  const info = {
    token0: token0.toLowerCase(),
    token1: token1.toLowerCase()
  };
  pairInfoCache.set(key, info);
  return info;
}

async function findCreationInfo(provider, address) {
  const key = address.toLowerCase();
  if (creationCache.has(key)) return creationCache.get(key);

  try {
    const latest = await provider.getBlockNumber();
    let low = 0;
    let high = latest;
    let creationBlock = null;

    for (let i = 0; i < 40 && low <= high; i++) {
      const mid = Math.floor((low + high) / 2);
      const code = await provider.getCode(address, mid);
      if (code && code !== '0x') {
        creationBlock = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    if (creationBlock !== null) {
      const block = await provider.getBlock(creationBlock);
      const info = {
        blockNumber: creationBlock,
        timestamp: block?.timestamp || null
      };
      creationCache.set(key, info);
      return info;
    }
  } catch (error) {
    console.warn('[Creation] Failed to resolve contract creation:', error.message);
  }

  creationCache.set(key, null);
  return null;
}

async function waitForReceipt(provider, txHash, timeoutMs = 240000) {
  try {
    return await provider.waitForTransaction(txHash, 1, timeoutMs);
  } catch (error) {
    console.warn(`[TX] Timeout waiting for ${txHash}:`, error.message);
    return null;
  }
}

function extractSwapAmounts({ receipt, pair, pairInfo, weth }) {
  const pairLower = pair.toLowerCase();
  for (const log of receipt.logs || []) {
    if (log.address.toLowerCase() !== pairLower) continue;
    if (!log.topics || log.topics[0] !== swapTopic) continue;

    try {
      const parsed = pairInterface.parseLog(log);
      const { amount0In, amount1In, amount0Out, amount1Out } = parsed.args;

      if (pairInfo.token0 === weth) {
        return {
          ethIn: amount0In,
          ethOut: amount0Out,
          tokenIn: amount1In,
          tokenOut: amount1Out
        };
      }

      if (pairInfo.token1 === weth) {
        return {
          ethIn: amount1In,
          ethOut: amount1Out,
          tokenIn: amount0In,
          tokenOut: amount0Out
        };
      }
    } catch (error) {
      console.warn('[Swap parse] Failed:', error.message);
    }
  }
  return null;
}

async function currentTokensPerEth(provider, pair, weth) {
  try {
    const contract = new ethers.Contract(pair, IUniswapV2Pair, provider);
    const [reserve0, reserve1] = await contract.getReserves();
    const token0 = await contract.token0();

    const isWeth0 = token0.toLowerCase() === weth;
    const wethReserve = isWeth0 ? reserve0 : reserve1;
    const tokenReserve = isWeth0 ? reserve1 : reserve0;

    if (wethReserve === 0n || tokenReserve === 0n) return 0n;
    return (tokenReserve * 10n ** 18n) / wethReserve;
  } catch (error) {
    console.warn('[Price] Failed to read reserves:', error.message);
    return 0n;
  }
}

function formatNumber(value, fractionDigits = 4) {
  return Number(value).toFixed(fractionDigits);
}

function toFloat(value) {
  return Number.parseFloat(value);
}

(async () => {
  console.log('🚀 Starting ETH Mempool Scanner (auto Banana Gun)...\n');

  const c = cfg();
  const { provider, hasWSS } = await createRobustProvider(c.rpcUrls);

  const telegramBot = c.tgToken && c.tgChat
    ? new TelegramBot(c.tgToken, { polling: false })
    : null;
  const notifier = new EnhancedNotifier(telegramBot, c.tgChat);
  const bananaGunClient = new BananaGunClient(c.bananaGun);

  const stats = {
    totalTrades: 0,
    profitable: 0,
    losing: 0,
    totalProfitEth: 0,
    totalLossEth: 0,
    totalGasEth: 0,
    bananaFees: []
  };

  const activeTrades = new Map();
  const signaledTokens = new Set();

  try {
    const network = await provider.getNetwork();
    const currentBlock = await provider.getBlockNumber();

    console.log(`✅ Connected to ${network.name} at block #${currentBlock}`);
    console.log(`🔌 Provider: ${hasWSS ? 'WebSocket realtime' : 'HTTP fallback'}\n`);

    if (bananaGunClient.enabled) {
      console.log('🍌 Banana Gun auto-trade: ENABLED');
      console.log(`   • Buy amount: ${c.bananaGun.amountEthDisplay} ETH`);
      console.log(`   • Slippage: ${c.bananaGun.slippageBps} BPS`);
      console.log(`   • Priority fee: ${c.bananaGun.priorityFeeGwei} gwei`);
      console.log(`   • Gas multiplier: ${c.bananaGun.gasMultiplier}`);
      console.log(`   • Sell percent: ${c.bananaGun.sellPercent}%`);
      console.log(`   • Telegram bot: ${c.bananaGun.botUsername}\n`);

      try {
        await bananaGunClient.connect();
        console.log('   ✅ Telegram session connected');
      } catch (error) {
        console.error('   ❌ Không thể kết nối Telegram:', error.message);
        throw error;
      }
    } else {
      console.log('🍌 Banana Gun auto-trade: DISABLED (thiếu cấu hình .env)\n');
    }

    await notifier.notifyBoot({
      network: network.name,
      chainId: network.chainId.toString(),
      hasWSS,
      settings: {
        minLP: c.minLP,
        maxLP: c.maxLP,
        taxMax: c.taxMax,
        taxMode: c.taxMode,
        priceGuard: c.priceGuard,
        priceMultiple: c.priceMultipleAbort
      }
    });
  } catch (e) {
    console.error('❌ Boot failed:', e.message);
    process.exit(1);
  }

  async function finalizeTrade(key, trade, sellSummary) {
    trade.timers?.forEach(clearTimeout);
    trade.watchers?.forEach(w => w?.stop?.());

    activeTrades.delete(key);

    if (!sellSummary) return;

    stats.totalTrades += 1;
    stats.totalGasEth += sellSummary.totalGasEth;

    if (sellSummary.pnlEth >= 0) {
      stats.profitable += 1;
      stats.totalProfitEth += sellSummary.pnlEth;
    } else {
      stats.losing += 1;
      stats.totalLossEth += Math.abs(sellSummary.pnlEth);
    }

    for (const fee of trade.bananaFees || []) {
      if (fee) stats.bananaFees.push(fee);
    }
  }

  async function handleSell({ trade, key, reason, notifyTimeout }) {
    if (trade.status !== 'bought') return;
    if (!bananaGunClient.enabled) {
      console.warn('Banana Gun client disabled - cannot sell');
      return;
    }

    trade.status = 'selling';

    if (notifyTimeout) {
      const priceNow = await currentTokensPerEth(provider, trade.pair, c.weth);
      if (priceNow > 0n && trade.buy) {
        const tokensValueWei = priceNow === 0n ? 0n : (trade.buy.tokensRaw * 10n ** 18n) / priceNow;
        const pnlEth = Number(ethers.formatEther(tokensValueWei - trade.buy.ethSpentWei));
        await notifier.notifyTimeoutStopLoss({
          token: trade.token,
          pair: trade.pair,
          metadata: trade.metadata,
          pnlPct: trade.buy.ethSpentEth === 0 ? 0 : (pnlEth / trade.buy.ethSpentEth) * 100
        });
      } else {
        await notifier.notifyTimeoutStopLoss({
          token: trade.token,
          pair: trade.pair,
          metadata: trade.metadata,
          pnlPct: -100
        });
      }
    }

    const currentBlock = await provider.getBlockNumber();

    let order;
    try {
      order = await bananaGunClient.submitSell({
        token: trade.token,
        pair: trade.pair,
        reason,
        metadata: { triggerBlock: currentBlock, triggerReason: reason }
      });
    } catch (error) {
      console.error('[BananaGun] Sell submit failed:', error);
      await notifier.notifyBananaGunOrderError({
        token: trade.token,
        pair: trade.pair,
        amountEth: 'SELL 100%',
        blockNumber: currentBlock,
        error: error.message,
        response: null
      });
      trade.status = 'bought';
      return;
    }

    if (!order.success) {
      await notifier.notifyBananaGunOrderError({
        token: trade.token,
        pair: trade.pair,
        amountEth: 'SELL 100%',
        blockNumber: currentBlock,
        error: order.error,
        response: order.response
      });
      trade.status = 'bought';
      return;
    }

    if (order.bananaFee) {
      trade.bananaFees = trade.bananaFees || [];
      trade.bananaFees.push(order.bananaFee);
    }

    await notifier.notifyBananaGunOrder({
      token: trade.token,
      pair: trade.pair,
      amountEth: 'SELL 100%',
      blockNumber: currentBlock,
      status: order.status,
      orderId: order.orderId,
      txHash: order.txHash,
      response: order.response,
      bananaFee: order.bananaFee,
      metadata: order.metadata
    });

    const receipt = order.txHash ? await waitForReceipt(provider, order.txHash) : null;
    if (!receipt) {
      console.warn('[BananaGun] Sell receipt missing');
      trade.status = 'sold';
      await finalizeTrade(key, trade, null);
      return;
    }

    const pairInfo = trade.pairInfo || await getPairInfo(provider, trade.pair);
    const swap = extractSwapAmounts({ receipt, pair: trade.pair, pairInfo, weth: c.weth });

    const sellBlock = receipt.blockNumber;
    const sellBlockData = await provider.getBlock(sellBlock);
    const timestamp = sellBlockData?.timestamp || Math.floor(Date.now() / 1000);

    const gasUsed = Number(receipt.gasUsed);
    const gasPrice = Number(ethers.formatUnits(receipt.effectiveGasPrice, 'gwei'));
    const gasCost = calculateGasCost(receipt.gasUsed, receipt.effectiveGasPrice);

    let ethReceivedWei = 0n;
    let tokensSold = 0n;

    if (swap) {
      ethReceivedWei = swap.ethOut ?? 0n;
      tokensSold = swap.tokenIn ?? 0n;
    }

    const ethReceivedEth = Number(ethers.formatEther(ethReceivedWei));
    const buyTotalCostWei = trade.buy.ethSpentWei + trade.buy.gasCostWei;
    const sellGasWei = receipt.gasUsed * receipt.effectiveGasPrice;
    const totalCostWei = buyTotalCostWei + sellGasWei;
    const pnlWei = ethReceivedWei - totalCostWei;
    const pnlEth = Number(ethers.formatEther(pnlWei));
    const pnlPct = trade.buy.ethSpentEth === 0
      ? 0
      : (pnlEth / trade.buy.ethSpentEth) * 100;

    const sellSummary = {
      blockNumber: sellBlock,
      timestamp,
      txHash: receipt.transactionHash,
      gasUsed,
      gasPrice,
      gasCost,
      ethReceived: formatNumber(ethReceivedEth, 6),
      ethReceivedWei,
      tokensSold,
      pnlEth,
      pnlPct,
      totalGasEth: toFloat(gasCost) + trade.buy.gasCostEth,
      bananaFee: order.bananaFee
    };

    trade.sell = sellSummary;
    trade.status = 'sold';

    await notifier.notifyAutoSellReport({
      token: trade.token,
      pair: trade.pair,
      metadata: trade.metadata,
      reason,
      detection: trade.detection,
      buy: trade.buy,
      sell: sellSummary,
      pnlPct,
      pnlEth,
      bananaFee: order.bananaFee
    });

    if (reason.toLowerCase().startsWith('rug pull')) {
      await notifier.notifyRugFrontRunResult({
        token: trade.token,
        pair: trade.pair,
        sell: sellSummary
      });
    }

    await finalizeTrade(key, trade, sellSummary);
  }

  function scheduleTimeout(trade, key) {
    const timer = setTimeout(() => {
      handleSell({ trade, key, reason: 'Timeout 10 phút', notifyTimeout: true });
    }, c.timeoutMs);
    trade.timers = trade.timers || [];
    trade.timers.push(timer);
  }

  function armRugWatcher(trade, key) {
    if (!hasWSS) return;

    const watcher = watchRugDefense({
      provider,
      pair: trade.pair,
      routers: [c.router],
      thresholdBp: c.rugThresholdBps,
      onThreat: async ({ kind, hash }) => {
        await notifier.notifyRugAlert({
          token: trade.token,
          pair: trade.pair,
          kind,
          rugTxHash: hash,
          blockNumber: await provider.getBlockNumber(),
          metadata: trade.metadata
        });

        await handleSell({ trade, key, reason: `Rug pull (${kind})`, notifyTimeout: false });
      }
    });

    trade.watchers = trade.watchers || [];
    trade.watchers.push(watcher);
  }

  watchMempoolAddLP({
    provider,
    routerList: [c.router],
    factory: c.factory,
    weth: c.weth,
    minLpEth: c.minLP,
    maxLpEth: c.maxLP,

    onCandidate: async ({ token, pair, eth, txHash }) => {
      const tokenLower = token.toLowerCase();
      if (activeTrades.has(tokenLower)) return;

      const [candidateBlock, block] = await Promise.all([
        provider.getBlockNumber(),
        provider.getBlock('latest')
      ]);

      const [metadata, pairInfo, creation] = await Promise.all([
        getTokenMetadata(provider, token),
        getPairInfo(provider, pair),
        findCreationInfo(provider, token)
      ]);

      await notifier.notifyCandidate({
        token,
        pair,
        eth,
        blockNumber: candidateBlock,
        txHash,
        creation,
        lpTimestamp: block?.timestamp || Math.floor(Date.now() / 1000),
        metadata
      });

      try {
        const baseTokensPerEthVal = await basePriceTokensPerEth({
          provider,
          router: c.router,
          token,
          weth: c.weth,
          pair
        });

        if (baseTokensPerEthVal === 0n) {
          await notifier.notifySkip({
            token, pair,
            reason: 'No base price',
            details: 'Router không trả về giá hợp lệ',
            blockNumber: candidateBlock,
            lpEth: eth
          });
          return;
        }

        const taxRes = await enforceStrictTax({
          provider,
          token,
          strictMaxBps: c.taxMax,
          mode: c.taxMode,
          router: c.router,
          weth: c.weth,
          pair
        });

        if (!taxRes.ok) {
          await notifier.notifySkip({
            token, pair,
            reason: taxRes.reason,
            details: taxRes.details,
            blockNumber: candidateBlock,
            lpEth: eth
          });
          return;
        }

        const selRes = await rejectBySelectors({
          provider,
          token,
          blockedNamesCsv: c.blocked
        });

        if (!selRes.ok) {
          await notifier.notifySkip({
            token, pair,
            reason: 'Malicious functions detected',
            details: 'Contract chứa hàm nguy hiểm (setTax, blacklist, ...)',
            blockNumber: candidateBlock,
            lpEth: eth
          });
          return;
        }

        let priceGuardInfo = null;
        if (c.priceGuard) {
          let nowTokens = 0n;
          let retryCount = 0;
          const maxRetries = 3;

          while (retryCount < maxRetries) {
            try {
              nowTokens = await basePriceTokensPerEth({
                provider,
                router: c.router,
                token,
                weth: c.weth,
                pair
              });

              if (nowTokens > 0n) break;

              retryCount += 1;
              if (retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            } catch (error) {
              retryCount += 1;
              if (retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            }
          }

          if (nowTokens === 0n) {
            priceGuardInfo = { status: 'skipped', reason: 'price_unavailable' };
          } else {
            const priceRatio = Number(baseTokensPerEthVal) / Number(nowTokens);
            const priceChangePercent = ((priceRatio - 1) * 100).toFixed(2);

            if (nowTokens * BigInt(c.priceMultipleAbort) < baseTokensPerEthVal) {
              const priceMultiple = Number(baseTokensPerEthVal) / Number(nowTokens);

              await notifier.notifySkip({
                token, pair,
                reason: `Price increased ${priceMultiple.toFixed(2)}x (limit: ${c.priceMultipleAbort}x)`,
                details: 'Possible frontrun detected',
                blockNumber: candidateBlock,
                lpEth: eth
              });
              return;
            }

            priceGuardInfo = {
              status: 'ok',
              priceRatio,
              priceChangePercent
            };
          }
        }

        const basePriceString = ethers.formatUnits(baseTokensPerEthVal, 18);

        signaledTokens.add(tokenLower);

        await notifier.notifySignal({
          token,
          pair,
          blockNumber: candidateBlock,
          lpEth: eth,
          basePriceTokensPerEth: baseTokensPerEthVal,
          taxBps: taxRes.reason?.match(/tax_(\d+)_bps/) ? Number(RegExp.$1) : null,
          taxDetails: taxRes.details,
          priceGuardInfo,
          bananaGun: bananaGunClient.enabled ? {
            amountEth: c.bananaGun.amountEthDisplay,
            slippageBps: c.bananaGun.slippageBps,
            priorityFeeGwei: c.bananaGun.priorityFeeGwei,
            gasMultiplier: c.bananaGun.gasMultiplier
          } : null,
          metadata,
          creation
        });

        if (!bananaGunClient.enabled) {
          console.log(`🍌 Signal ready for ${token} → copy to Banana Gun manually.`);
          return;
        }

        const trade = {
          token,
          pair,
          metadata,
          pairInfo,
          detection: {
            blockNumber: candidateBlock,
            lpTimestamp: block?.timestamp || Math.floor(Date.now() / 1000),
            creation,
            basePrice: basePriceString,
            baseTokensPerEth: baseTokensPerEthVal
          },
          bananaFees: [],
          status: 'pending'
        };

        activeTrades.set(tokenLower, trade);

        console.log(`🍌 Auto-buy submitting for ${token}`);

        let order;
        try {
          order = await bananaGunClient.submitBuy({
            token,
            pair,
            blockNumber: candidateBlock,
            lpEth: eth,
            basePriceTokensPerEth: baseTokensPerEthVal,
            taxBps: taxRes.reason?.match(/tax_(\d+)_bps/) ? Number(RegExp.$1) : null,
            priceGuardInfo
          });
        } catch (error) {
          console.error('[BananaGun] Submit failed:', error);
          await notifier.notifyBananaGunOrderError({
            token,
            pair,
            amountEth: c.bananaGun.amountEthDisplay,
            blockNumber: candidateBlock,
            error: error.message,
            response: null
          });
          activeTrades.delete(tokenLower);
          return;
        }

        if (!order.success) {
          await notifier.notifyBananaGunOrderError({
            token,
            pair,
            amountEth: c.bananaGun.amountEthDisplay,
            blockNumber: candidateBlock,
            error: order.error,
            response: order.response
          });
          activeTrades.delete(tokenLower);
          return;
        }

        if (order.bananaFee) {
          trade.bananaFees.push(order.bananaFee);
        }

        await notifier.notifyBananaGunOrder({
          token,
          pair,
          amountEth: c.bananaGun.amountEthDisplay,
          blockNumber: candidateBlock,
          status: order.status,
          orderId: order.orderId,
          txHash: order.txHash,
          response: order.response,
          bananaFee: order.bananaFee,
          metadata: order.metadata
        });

        const receipt = order.txHash ? await waitForReceipt(provider, order.txHash) : null;
        if (!receipt) {
          console.warn('[BananaGun] Buy receipt missing');
          trade.status = 'aborted';
          return;
        }

        const swap = extractSwapAmounts({ receipt, pair, pairInfo, weth: c.weth });
        const blockData = await provider.getBlock(receipt.blockNumber);
        const timestamp = blockData?.timestamp || Math.floor(Date.now() / 1000);

        const gasUsed = Number(receipt.gasUsed);
        const gasPrice = Number(ethers.formatUnits(receipt.effectiveGasPrice, 'gwei'));
        const gasCost = calculateGasCost(receipt.gasUsed, receipt.effectiveGasPrice);

        let tokensOut = 0n;
        let ethIn = c.bananaGun.amountWei;
        if (swap) {
          tokensOut = swap.tokenOut ?? 0n;
          ethIn = swap.ethIn ?? c.bananaGun.amountWei;
        }

        const buyPriceTokensPerEth = ethIn === 0n ? 0n : (tokensOut * 10n ** 18n) / ethIn;
        const basePriceNum = Number(ethers.formatUnits(baseTokensPerEthVal, 18));
        const buyPriceNum = Number(ethers.formatUnits(buyPriceTokensPerEth, 18));
        const priceImpactPct = basePriceNum === 0 ? 0 : ((buyPriceNum - basePriceNum) / basePriceNum) * 100;

        const gasCostWei = receipt.gasUsed * receipt.effectiveGasPrice;
        const buySummary = {
          blockNumber: receipt.blockNumber,
          timestamp,
          txHash: receipt.transactionHash,
          tokens: ethers.formatUnits(tokensOut, metadata.decimals),
          tokensRaw: tokensOut,
          price: ethers.formatUnits(buyPriceTokensPerEth, 18),
          priceTokensPerEth: buyPriceTokensPerEth,
          ethSpentWei: ethIn,
          ethSpentEth: Number(ethers.formatEther(ethIn)),
          gasUsed,
          gasPrice,
          gasCost,
          gasCostWei,
          gasCostEth: toFloat(gasCost)
        };

        trade.buy = buySummary;
        trade.status = 'bought';

        await notifier.notifyBananaGunBuyReport({
          token,
          pair,
          metadata,
          detection: trade.detection,
          buy: buySummary,
          amountEth: c.bananaGun.amountEthDisplay,
          priceImpactPct,
          bananaFee: order.bananaFee
        });

        scheduleTimeout(trade, tokenLower);
        armRugWatcher(trade, tokenLower);
      } catch (error) {
        console.error('Candidate processing error:', error);
        await notifier.send(`⚠️ ERROR: ${token.slice(0,10)}... - ${error.message}`);
        activeTrades.delete(tokenLower);
      }
    }
  });

  process.on('SIGINT', async () => {
    console.log('\n⏹️  Shutting down scanner...');
    await notifier.notifyShutdown({ reason: 'Manual shutdown (Ctrl+C)' });

    const totalTrades = stats.totalTrades;
    const successful = stats.profitable;
    const failed = stats.losing;
    const winRate = totalTrades === 0 ? 0 : (successful / totalTrades) * 100;
    const netProfitEth = stats.totalProfitEth - stats.totalLossEth;

    await notifier.notifySessionSummary({
      totalTrades,
      successful,
      failed,
      totalProfitEth: stats.totalProfitEth,
      totalLossEth: stats.totalLossEth,
      netProfitEth,
      winRate,
      bananaFees: stats.bananaFees,
      gasEth: stats.totalGasEth
    });

    process.exit(0);
  });

  process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    notifier.send(`💥 CRITICAL: ${error.message}`);
  });

})().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
