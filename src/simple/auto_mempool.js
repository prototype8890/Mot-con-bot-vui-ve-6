import 'dotenv/config';
import { ethers } from 'ethers';
import TelegramBot from 'node-telegram-bot-api';
import { watchMempoolAddLP } from './mempoolAddLPWatcher.js';
import { enforceStrictTax, rejectBySelectors, basePriceTokensPerEth } from './filters.js';
import { createRobustProvider } from './providerSelector.js';
import { EnhancedNotifier } from './enhancedNotifier.js';
import { BananaGunClient } from './bananaGunClient.js';
import { IUniswapV2Pair, IERC20 } from './abi.js';
import { watchRugDefense } from './rugWatcher.js';
import { RiskManager } from './riskManager.js';
import { AnalyticsStore } from './database.js';
import { evaluateTokenWithMl } from './mlFilter.js';
import { runHoneypotChecks } from './honeypot.js';
import { GasOptimizer } from './gasOptimizer.js';
import { DashboardServer } from './dashboard.js';
import { withRetry } from './errorUtils.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const walletAddressRaw = e.BANANA_GUN_WALLET_ADDRESS?.trim();
    if (walletAddressRaw && !ethers.isAddress(walletAddressRaw)) {
      throw new Error('❌ BANANA_GUN_WALLET_ADDRESS không hợp lệ');
    }

    const walletAddress = walletAddressRaw ? walletAddressRaw.toLowerCase() : null;

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

  const priceGuardRetryDelayMs = Number(e.PRICE_GUARD_RETRY_DELAY_MS || '250');
  if (!Number.isFinite(priceGuardRetryDelayMs) || priceGuardRetryDelayMs < 100) {
    throw new Error('❌ PRICE_GUARD_RETRY_DELAY_MS phải ≥ 100');
  }

  const priceMultipleAbort = Number(e.PRICE_MULTIPLE_ABORT || '3');
  if (!Number.isFinite(priceMultipleAbort) || priceMultipleAbort <= 1) {
    throw new Error('❌ PRICE_MULTIPLE_ABORT phải là số > 1');
  }

  const priceMultipleAbortScaled = BigInt(Math.round(priceMultipleAbort * 1e6));
  if (priceMultipleAbortScaled <= 1_000_000n) {
    throw new Error('❌ PRICE_MULTIPLE_ABORT quá nhỏ (phải > 1.0x)');
  }

  const dexes = (() => {
    if (e.DEX_CONFIG_JSON) {
      try {
        const parsed = JSON.parse(e.DEX_CONFIG_JSON);
        if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('DEX_CONFIG_JSON must be array');
        return parsed.map((dex) => ({
          name: dex.name || 'DEX',
          router: (dex.router || dex.routers?.[0] || '').toLowerCase(),
          routers: (dex.routers || [dex.router]).filter(Boolean).map((r) => r.toLowerCase()),
          factory: (dex.factory || '').toLowerCase(),
          slug: dex.slug || 'ethereum',
          explorer: dex.explorer || 'etherscan.io',
          chain: dex.chain || 'eth'
        }));
      } catch (error) {
        throw new Error(`❌ DEX_CONFIG_JSON không hợp lệ: ${error.message}`);
      }
    }

    const routers = (e.ROUTER_V2_LIST || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
    const primaryRouter = (e.ROUTER_V2 || routers[0] || '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D').toLowerCase();
    if (!ethers.isAddress(primaryRouter)) {
      throw new Error('❌ ROUTER_V2 không hợp lệ');
    }

    const factory = (e.FACTORY_V2 || '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f').toLowerCase();
    if (!ethers.isAddress(factory)) {
      throw new Error('❌ FACTORY_V2 không hợp lệ');
    }

    const list = routers.length ? routers : [primaryRouter];

    return [{
      name: e.DEX_NAME || 'UniswapV2',
      router: primaryRouter,
      routers: list,
      factory,
      slug: e.DEX_SLUG || 'ethereum',
      explorer: e.DEX_EXPLORER || 'etherscan.io',
      chain: e.DEX_CHAIN || 'eth'
    }];
  })();

  const mlThreshold = Number(e.ML_SCORE_THRESHOLD || '62');
  const mlEnabled = Number(e.ML_FILTER_ENABLED || '1') === 1;
  const honeypotMinLpRatio = Number(e.HONEYPOT_MIN_LP_RATIO || '0.02');
  const maxConsecutiveLosses = Number(e.MAX_CONSECUTIVE_LOSSES || '3');
  const cooldownMinutes = Number(e.CIRCUIT_BREAKER_COOLDOWN_MINUTES || '30');
  const analyticsEnabled = Number(e.ANALYTICS_ENABLED || '1') === 1;
  const analyticsPath = e.ANALYTICS_DB_PATH || 'data/analytics.db';
  const dashboardEnabled = Number(e.WEB_DASHBOARD_ENABLED || '0') === 1;
  const dashboardPort = Number(e.WEB_DASHBOARD_PORT || '8787');
  const trailingStopBps = Number(e.TRAILING_STOP_BPS || '800');
  const takeProfitTargetBps = Number(e.SMART_TP_TARGET_BPS || '1500');
  const takeProfitTrailBps = Number(e.SMART_TP_TRAIL_BPS || '500');
  const retryMaxAttempts = Number(e.RETRY_MAX_ATTEMPTS || '3');
  const retryBaseDelayMs = Number(e.RETRY_BASE_DELAY_MS || '200');
  const gasOptimizerCacheMs = Number(e.GAS_OPTIMIZER_CACHE_MS || '5000');

  return {
    rpcUrls: e.RPC_URLS,
    weth: (e.WETH || '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2').toLowerCase(),
    dexes,
    minLP: Number(e.MIN_LP_ETH || '0.5'),
    maxLP: Number(e.MAX_LP_ETH || '1'),
    taxMax: Number(e.STRICT_TAX_BPS_MAX || '0'),
    taxMode: e.STRICT_TAX_MODE || 'reject_unknown',
    blocked: e.BLOCKLIST_SELECTORS || '',
    priceGuard: Number(e.PRICE_GUARD || '1') === 1,
    priceMultipleAbort,
    priceMultipleAbortScaled,
    priceGuardRetryDelayMs,
    tgToken: e.TELEGRAM_BOT_TOKEN || e.TELEGRAM_TOKEN || '',
    tgChat: e.TELEGRAM_CHAT_ID || '',
    bananaGun,
    timeoutMs: timeoutMinutes * 60 * 1000,
    rugThresholdBps,
    ml: { enabled: mlEnabled, threshold: mlThreshold },
    honeypotMinLpRatio,
    risk: { maxConsecutiveLosses, cooldownMinutes },
    analytics: { enabled: analyticsEnabled, dbPath: analyticsPath },
    dashboard: { enabled: dashboardEnabled, port: dashboardPort },
    trailingStopBps,
    takeProfitTargetBps,
    takeProfitTrailBps,
    retry: { maxAttempts: retryMaxAttempts, baseDelayMs: retryBaseDelayMs },
    gasOptimizer: { cacheMs: gasOptimizerCacheMs },
    maxConcurrentTrades: (() => {
      const limit = Number(e.MAX_CONCURRENT_TRADES || '3');
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error('❌ MAX_CONCURRENT_TRADES phải là số > 0');
      }
      return Math.floor(limit);
    })()
  };
}

const pairInterface = new ethers.Interface(IUniswapV2Pair);
const swapTopic = pairInterface.getEventTopic('Swap');
const pairInfoCache = new Map();
const tokenMetaCache = new Map();
const creationCache = new Map();

function calculateGasCost(gasUsed, effectiveGasPrice) {
  if (!gasUsed || !effectiveGasPrice) {
    return { wei: 0n, eth: 0 };
  }
  const wei = gasUsed * effectiveGasPrice;
  return { wei, eth: Number(ethers.formatEther(wei)) };
}

function computePnlPercentage(trade, priceTokensPerEth) {
  if (!trade?.buy?.tokensRaw || !trade?.buy?.ethSpentWei) return 0;
  if (!priceTokensPerEth || priceTokensPerEth === 0n) return 0;
  const tokensValueWei = (trade.buy.tokensRaw * 10n ** 18n) / priceTokensPerEth;
  const pnlWei = tokensValueWei - trade.buy.ethSpentWei;
  const pnlEth = Number(ethers.formatEther(pnlWei));
  const spentEth = Number(ethers.formatEther(trade.buy.ethSpentWei));
  if (!Number.isFinite(spentEth) || spentEth === 0) return 0;
  return (pnlEth / spentEth) * 100;
}

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
      const block = await provider.getBlock(creationBlock, true);
      let creator = null;
      let txHash = null;

      if (block?.transactions?.length) {
        for (const tx of block.transactions) {
          try {
            const receipt = await provider.getTransactionReceipt(tx.hash || tx);
            if (receipt?.contractAddress?.toLowerCase() === key) {
              creator = (tx.from || receipt.from || '').toLowerCase();
              txHash = receipt.transactionHash;
              break;
            }
          } catch {}
        }
      }

      const info = {
        blockNumber: creationBlock,
        timestamp: block?.timestamp || null,
        creator,
        txHash
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
  let providerInfo = await createRobustProvider(c.rpcUrls);
  let provider = providerInfo.provider;
  let hasWSS = providerInfo.hasWSS;

  const telegramBot = c.tgToken && c.tgChat
    ? new TelegramBot(c.tgToken, { polling: false })
    : null;
  const notifier = new EnhancedNotifier(telegramBot, c.tgChat);
  const bananaGunClient = new BananaGunClient(c.bananaGun);
  const analyticsStore = new AnalyticsStore({ enabled: c.analytics.enabled, dbPath: c.analytics.dbPath });
  await analyticsStore.init();
  const riskManager = new RiskManager({
    maxConsecutiveLosses: c.risk.maxConsecutiveLosses,
    cooldownMinutes: c.risk.cooldownMinutes,
    notifier
  });
  const gasOptimizer = new GasOptimizer({
    cacheMs: c.gasOptimizer.cacheMs,
    multiplier: c.bananaGun?.gasMultiplier || 1,
    priorityFeeOverrideGwei: c.bananaGun?.priorityFeeGwei ?? null
  });

  const stats = {
    attempts: 0,
    completed: 0,
    profitable: 0,
    losing: 0,
    aborted: 0,
    totalProfitEth: 0,
    totalLossEth: 0,
    totalGasEth: 0,
    bananaFees: []
  };

  const activeTrades = new Map();
  const signaledTokens = new Set();
  const dashboard = new DashboardServer({
    enabled: c.dashboard.enabled,
    port: c.dashboard.port,
    statsProvider: () => ({
      ...stats,
      activeTrades: Array.from(activeTrades.values()).map((trade) => ({
        token: trade.token,
        status: trade.status,
        pnlPct: trade.currentPnlPct || 0
      }))
    })
  });

  await dashboard.start();

  let watcher = null;
  let wsCleanup = null;
  let reconnecting = false;
  let shuttingDown = false;

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
        priceMultiple: c.priceMultipleAbort,
        mlThreshold: c.ml.threshold,
        maxConsecutiveLosses: c.risk.maxConsecutiveLosses
      }
    });
  } catch (e) {
    console.error('❌ Boot failed:', e.message);
    process.exit(1);
  }

  function cleanupTradeResources(trade) {
    trade.timers?.forEach(clearTimeout);
    trade.watchers?.forEach(w => w?.stop?.());
    if (trade.timers) trade.timers.length = 0;
    if (trade.watchers) trade.watchers.length = 0;
  }

  async function finalizeTrade(key, trade, { sellSummary = null, outcome = 'sold' } = {}) {
    cleanupTradeResources(trade);

    activeTrades.delete(key);

    for (const fee of trade.bananaFees || []) {
      if (fee) stats.bananaFees.push(fee);
    }

    if (outcome === 'aborted') {
      stats.aborted += 1;
      return;
    }

    if (!sellSummary) {
      stats.losing += 1;
      riskManager.recordOutcome('loss');
      return;
    }

    stats.completed += 1;
    stats.totalGasEth += sellSummary.totalGasEth;

    if (sellSummary.pnlEth >= 0) {
      stats.profitable += 1;
      stats.totalProfitEth += sellSummary.pnlEth;
      riskManager.recordOutcome('win');
    } else {
      stats.losing += 1;
      stats.totalLossEth += Math.abs(sellSummary.pnlEth);
      riskManager.recordOutcome('loss');
    }

    await analyticsStore.recordTrade({
      token: trade.token,
      pair: trade.pair,
      action: 'sell',
      amount: sellSummary.proceedsEth ?? null,
      pnl: sellSummary.pnlEth,
      gas: sellSummary.totalGasEth,
      metadata: {
        reason: trade.exitReason || outcome,
        blockNumber: sellSummary.blockNumber,
        dex: trade.dex?.name || null
      }
    });
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
        metadata: { triggerBlock: currentBlock, triggerReason: reason },
        dex: trade.dex
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
      await finalizeTrade(key, trade, { outcome: 'aborted' });
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
      proceedsEth: ethReceivedEth,
      totalGasEth: toFloat(gasCost) + trade.buy.gasCostEth,
      bananaFee: order.bananaFee
    };

    trade.sell = sellSummary;
    trade.status = 'sold';
    trade.exitReason = reason;

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

    await finalizeTrade(key, trade, { sellSummary, outcome: pnlEth >= 0 ? 'profit' : 'loss' });
  }

  function scheduleTimeout(trade, key) {
    const timeoutMinutes = Math.max(1, Math.round(c.timeoutMs / 60000));
    const timer = setTimeout(() => {
      handleSell({
        trade,
        key,
        reason: `Timeout ${timeoutMinutes} phút`,
        notifyTimeout: true
      });
    }, c.timeoutMs);
    trade.timers = trade.timers || [];
    trade.timers.push(timer);
  }

  function startSmartStops(trade, key) {
    const interval = setInterval(async () => {
      if (trade.status !== 'bought') return;
      try {
        const current = await currentTokensPerEth(provider, trade.pair, c.weth);
        if (!current || current === 0n) return;

        trade.currentPnlPct = computePnlPercentage(trade, current);
        if (trade.highestPnlPct === undefined || trade.currentPnlPct > trade.highestPnlPct) {
          trade.highestPnlPct = trade.currentPnlPct;
        }

        const drawdown = (trade.highestPnlPct ?? 0) - (trade.currentPnlPct ?? 0);

        const targetPct = c.takeProfitTargetBps / 100;
        const trailPct = c.takeProfitTrailBps / 100;
        const stopPct = c.trailingStopBps / 100;

        if (!trade.takeProfitArmed && trade.currentPnlPct >= targetPct) {
          trade.takeProfitArmed = true;
        }

        if (trade.takeProfitArmed && drawdown >= trailPct) {
          clearInterval(interval);
          await handleSell({ trade, key, reason: 'Take-profit trailing', notifyTimeout: false });
          return;
        }

        if (trade.currentPnlPct <= -stopPct || drawdown >= stopPct) {
          clearInterval(interval);
          await handleSell({ trade, key, reason: 'Trailing stop', notifyTimeout: false });
        }
      } catch (error) {
        console.warn('[SmartStop] update failed:', error.message);
      }
    }, 15000);

    trade.timers = trade.timers || [];
    trade.timers.push(interval);
  }

  function armRugWatcher(trade, key) {
    if (!hasWSS) return;

    const watcher = watchRugDefense({
      provider,
      pair: trade.pair,
      routers: trade.dex?.routers || c.dexes[0]?.routers || [],
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

  async function handleWatcherInfo(info) {
    if (!info) return;
    const { token, pair, lpEth, dex } = info;
    const base = {
      token: token || 'unknown',
      pair: pair || 'unknown',
      lpEth: lpEth || null,
      dex
    };

    switch (info.type) {
      case 'out_of_range':
        await notifier.notifySkip({
          ...base,
          reason: 'LP out of configured range',
          details: `LP=${lpEth} (yêu cầu ${info.min}-${info.max})`,
          blockNumber: null,
          lpEth,
          dex
        });
        break;
      case 'mint_timeout':
        await notifier.notifySkip({
          ...base,
          reason: 'Không thấy thanh khoản sau PairCreated',
          details: 'Có thể là bait hoặc giao dịch thất bại',
          blockNumber: null,
          lpEth,
          dex
        });
        break;
      default:
        console.log('[mempool] Info:', info);
    }
  }

  async function handleCandidate({ token, pair, eth, txHash, dex }) {
    const tokenLower = token.toLowerCase();
    if (activeTrades.has(tokenLower)) return;

    if (!riskManager.canEnterTrade()) {
      await notifier.notifySkip({
        token,
        pair,
        reason: 'Circuit breaker đang bật',
        details: 'Đang trong thời gian cooldown sau chuỗi lỗ',
        blockNumber: null,
        lpEth: eth,
        dex
      });
      return;
    }

    if (activeTrades.size >= c.maxConcurrentTrades) {
      await notifier.notifySkip({
        token,
        pair,
        reason: `Đạt giới hạn giao dịch đồng thời (${c.maxConcurrentTrades})`,
        details: 'Chờ giao dịch hiện tại hoàn tất',
        blockNumber: null,
        lpEth: eth,
        dex
      });
      return;
    }

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
      metadata,
      dex
    });

    try {
      const routerAddress = (dex?.router || dex?.routers?.[0] || c.dexes[0]?.router || c.dexes[0]?.routers?.[0])?.toLowerCase();
      if (!routerAddress) {
        throw new Error('Không tìm thấy router cho DEX');
      }

      const baseTokensPerEthVal = await withRetry(() => basePriceTokensPerEth({
        provider,
        router: routerAddress,
        token,
        weth: c.weth,
        pair
      }), {
        retries: c.retry.maxAttempts,
        baseDelayMs: c.retry.baseDelayMs,
        onError: (err, attempt) => console.warn(`[Price] retry ${attempt + 1} failed:`, err.message)
      });

      if (!baseTokensPerEthVal || baseTokensPerEthVal === 0n) {
        await notifier.notifySkip({
          token, pair,
          reason: 'No base price',
          details: 'Router không trả về giá hợp lệ',
          blockNumber: candidateBlock,
          lpEth: eth,
          dex
        });
        return;
      }

      const taxRes = await enforceStrictTax({
        provider,
        token,
        strictMaxBps: c.taxMax,
        mode: c.taxMode,
        router: routerAddress,
        weth: c.weth,
        pair
      });

      if (!taxRes.ok) {
        await notifier.notifySkip({
          token, pair,
          reason: taxRes.reason,
          details: taxRes.details,
          blockNumber: candidateBlock,
          lpEth: eth,
          dex
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
          lpEth: eth,
          dex
        });
        return;
      }

      let priceGuardInfo = null;
      if (c.priceGuard) {
        try {
          const nowTokens = await withRetry(() => basePriceTokensPerEth({
            provider,
            router: routerAddress,
            token,
            weth: c.weth,
            pair
          }), {
            retries: c.retry.maxAttempts,
            baseDelayMs: c.priceGuardRetryDelayMs,
            onError: (err) => console.warn('[PriceGuard]', err.message)
          });

          if (!nowTokens || nowTokens === 0n) {
            priceGuardInfo = { status: 'skipped', reason: 'price_unavailable' };
          } else {
            const scaledRatio = nowTokens === 0n ? 0n : (baseTokensPerEthVal * 1_000_000n) / nowTokens;
            const priceRatio = Number(scaledRatio) / 1_000_000;
            const priceChangePercent = ((priceRatio - 1) * 100).toFixed(2);

            if (baseTokensPerEthVal * 1_000_000n > nowTokens * c.priceMultipleAbortScaled) {
              const priceMultiple = Number(scaledRatio) / 1_000_000;

              await notifier.notifySkip({
                token, pair,
                reason: `Price increased ${priceMultiple.toFixed(2)}x (limit: ${c.priceMultipleAbort}x)`,
                details: 'Possible frontrun detected',
                blockNumber: candidateBlock,
                lpEth: eth,
                dex
              });
              return;
            }

            priceGuardInfo = {
              status: 'ok',
              priceRatio,
              priceChangePercent
            };
          }
        } catch (error) {
          priceGuardInfo = { status: 'skipped', reason: 'price_error', message: error.message };
        }
      }

      let deployerTxCount = 0;
      if (creation?.creator) {
        try {
          deployerTxCount = Number(await provider.getTransactionCount(creation.creator, creation.blockNumber));
        } catch (err) {
          console.warn('[ML] Không thể lấy số giao dịch của deployer:', err.message);
        }
      }

      const deployerHistoryScore = deployerTxCount > 50 ? 1 : deployerTxCount > 10 ? 0.5 : deployerTxCount === 0 ? -0.5 : 0;
      const tokenAgeMinutes = creation?.timestamp ? Math.max(0, (Date.now() / 1000 - creation.timestamp) / 60) : 0;
      const taxScore = taxRes.reason?.includes('tax_') ? 1 : 0.5;

      let mlResult = null;
      if (c.ml.enabled) {
        mlResult = evaluateTokenWithMl({
          lpEth: eth,
          tokenAgeMinutes,
          deployerHistoryScore,
          holderDistributionScore: 0,
          socialScore: 0,
          taxScore
        }, c.ml.threshold);

        await analyticsStore.recordDetection({
          token,
          pair,
          score: mlResult.score,
          reason: mlResult.passed ? 'pass' : 'fail'
        });

        if (!mlResult.passed) {
          await notifier.notifyMlReject({
            token,
            score: mlResult.score,
            threshold: mlResult.threshold,
            breakdown: mlResult.breakdown
          });
          return;
        }
      }

      const honeypot = await runHoneypotChecks({
        provider,
        token,
        pair,
        router: routerAddress,
        weth: c.weth,
        minLiquidityRatio: c.honeypotMinLpRatio
      });

      if (honeypot.suspicious) {
        await notifier.notifyHoneypot({ token, reasons: honeypot.reasons });
        return;
      }

      let gasRecommendationText = null;
      try {
        const feeSuggestion = await gasOptimizer.getFeeData(provider);
        if (feeSuggestion) {
          const maxFee = Number(ethers.formatUnits(feeSuggestion.maxFeePerGas, 'gwei')).toFixed(2);
          const priority = Number(ethers.formatUnits(feeSuggestion.maxPriorityFeePerGas, 'gwei')).toFixed(2);
          gasRecommendationText = `${maxFee} gwei / ${priority} gwei`;
        }
      } catch (error) {
        console.warn('[GasOptimizer] Failed to fetch fee suggestion:', error.message);
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
        creation,
        dex,
        mlScore: mlResult,
        honeypot,
        gasRecommendation: gasRecommendationText
      });

      if (!bananaGunClient.enabled) {
        console.log(`🍌 Signal ready for ${token} → copy to Banana Gun manually.`);
        return;
      }

      const trade = {
        token,
        pair,
        dex,
        metadata,
        pairInfo,
        detection: {
          blockNumber: candidateBlock,
          lpTimestamp: block?.timestamp || Math.floor(Date.now() / 1000),
          creation,
          basePrice: basePriceString,
          baseTokensPerEth: baseTokensPerEthVal
        },
        mlScore: mlResult,
        honeypot,
        gasRecommendation: gasRecommendationText,
        bananaFees: [],
        status: 'pending'
      };

      stats.attempts += 1;
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
          priceGuardInfo,
          dex
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
        await finalizeTrade(tokenLower, trade, { outcome: 'aborted' });
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
        await finalizeTrade(tokenLower, trade, { outcome: 'aborted' });
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
        await finalizeTrade(tokenLower, trade, { outcome: 'aborted' });
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
      trade.currentPnlPct = 0;
      trade.highestPnlPct = 0;

      await analyticsStore.recordTrade({
        token,
        pair,
        action: 'buy',
        amount: Number(ethers.formatEther(ethIn)),
        pnl: null,
        gas: buySummary.gasCostEth,
        metadata: { dex: dex?.name, blockNumber: receipt.blockNumber }
      });

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
      startSmartStops(trade, tokenLower);
      armRugWatcher(trade, tokenLower);
    } catch (error) {
      console.error('Candidate processing error:', error);
      if (error?.stack) {
        console.error(error.stack);
      }
      await notifier.send(`⚠️ ERROR: ${token.slice(0,10)}... - ${error.message}`);

      const existing = activeTrades.get(tokenLower);
      if (existing) {
        await finalizeTrade(tokenLower, existing, { outcome: 'aborted' });
      } else {
        activeTrades.delete(tokenLower);
      }
    }
  }

  function startMempoolWatcher() {
    if (watcher) {
      try {
        watcher.stop?.();
      } catch (error) {
        console.error('Failed to stop previous mempool watcher:', error?.message || error);
      }
    }

    watcher = watchMempoolAddLP({
      provider,
      dexes: c.dexes,
      weth: c.weth,
      minLpEth: c.minLP,
      maxLpEth: c.maxLP,
      onCandidate: handleCandidate,
      onInfo: handleWatcherInfo
    });
  }

  function attachProviderEvents() {
    wsCleanup?.();

    if (!(provider instanceof ethers.WebSocketProvider)) {
      wsCleanup = null;
      return;
    }

    const ws = provider._websocket || provider._ws || provider.websocket;
    if (!ws?.on) {
      wsCleanup = null;
      return;
    }

    const onClose = (code, reason) => {
      if (shuttingDown) return;
      console.error(`[Provider] WebSocket closed: code=${code} reason=${reason?.toString?.() || ''}`);
      void notifier.send('⚠️ RPC WebSocket đã đóng kết nối – đang thử kết nối lại...').catch(() => {});
      void attemptReconnect(`close ${code}`);
    };

    const onError = (err) => {
      if (shuttingDown) return;
      console.error('[Provider] WebSocket error:', err?.message || err);
      void notifier.send('⚠️ RPC WebSocket gặp lỗi – đang thử kết nối lại...').catch(() => {});
      void attemptReconnect(`error ${err?.message || err}`);
    };

    ws.on('close', onClose);
    ws.on('error', onError);

    wsCleanup = () => {
      try { ws.off('close', onClose); } catch {}
      try { ws.off('error', onError); } catch {}
    };
  }

  async function attemptReconnect(reason) {
    if (shuttingDown || reconnecting) return;
    reconnecting = true;

    console.warn(`[Provider] Attempting reconnect due to ${reason}`);
    await notifier.send('🔄 Đang thử reconnect RPC...').catch(() => {});

    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        wsCleanup?.();
        if (typeof provider?.destroy === 'function') {
          try { provider.destroy(); } catch {}
        }

        providerInfo = await createRobustProvider(c.rpcUrls);
        provider = providerInfo.provider;
        hasWSS = providerInfo.hasWSS;

        startMempoolWatcher();
        attachProviderEvents();

        for (const [key, trade] of activeTrades.entries()) {
          if (trade.watchers?.length) {
            trade.watchers.forEach((w) => w?.stop?.());
            trade.watchers.length = 0;
          }
          if (hasWSS && trade.status === 'bought') {
            armRugWatcher(trade, key);
          }
        }

        await notifier.send('✅ RPC đã kết nối lại, tiếp tục theo dõi.').catch(() => {});
        reconnecting = false;
        return;
      } catch (error) {
        console.error(`[Provider] Reconnect attempt ${attempt} failed:`, error?.message || error);
        await sleep(Math.min(5000, 1000 * attempt));
      }
    }

    await notifier.send('❌ Không thể reconnect RPC sau nhiều lần thử - bot sẽ dừng.').catch(() => {});
    process.exit(1);
  }

  startMempoolWatcher();
  attachProviderEvents();

  process.on('SIGINT', async () => {
    console.log('\n⏹️  Shutting down scanner...');
    shuttingDown = true;
    try {
      watcher?.stop?.();
    } catch (error) {
      console.error('Failed to stop mempool watcher:', error?.message || error);
    }

    try {
      wsCleanup?.();
      if (typeof provider?.destroy === 'function') {
        provider.destroy();
      }
    } catch (error) {
      console.error('Failed to dispose provider:', error?.message || error);
    }

    for (const [key, trade] of Array.from(activeTrades.entries())) {
      cleanupTradeResources(trade);
      activeTrades.delete(key);
    }

    await dashboard.stop();
    await analyticsStore.close();
    riskManager.shutdown();

    await notifier.notifyShutdown({ reason: 'Manual shutdown (Ctrl+C)' });

    const attempts = stats.attempts;
    const completed = stats.completed;
    const successful = stats.profitable;
    const failed = stats.losing;
    const aborted = stats.aborted;
    const winRateBase = completed + aborted;
    const winRate = winRateBase === 0 ? 0 : (successful / winRateBase) * 100;
    const netProfitEth = stats.totalProfitEth - stats.totalLossEth;

    await notifier.notifySessionSummary({
      attempts,
      completed,
      profitable: successful,
      losing: failed,
      aborted,
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
