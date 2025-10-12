import 'dotenv/config';
import { ethers } from 'ethers';
import TelegramBot from 'node-telegram-bot-api';
import { watchMempoolAddLP } from './mempoolAddLPWatcher.js';
import { enforceStrictTax, rejectBySelectors, basePriceTokensPerEth } from './filters.js';
import { createRobustProvider } from './providerSelector.js';
import { EnhancedNotifier } from './enhancedNotifier.js';
import { BananaGunClient } from './bananaGunClient.js';

function cfg() {
  const e = process.env;
  if (!e.RPC_URLS) throw new Error('❌ RPC_URLS missing');

  const bananaGun = (() => {
    const enabled = Boolean(
      e.BANANA_GUN_API_URL &&
      e.BANANA_GUN_API_KEY &&
      e.BANANA_GUN_WALLET_ID &&
      e.BANANA_GUN_BUY_AMOUNT_ETH
    );

    if (!enabled) {
      return { enabled: false };
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

    const autoApprove = Number(e.BANANA_GUN_AUTO_APPROVE || '1') === 1;

    let extraHeaders = {};
    if (e.BANANA_GUN_EXTRA_HEADERS) {
      try {
        extraHeaders = JSON.parse(e.BANANA_GUN_EXTRA_HEADERS);
      } catch (err) {
        throw new Error(`❌ BANANA_GUN_EXTRA_HEADERS không phải JSON hợp lệ: ${err.message}`);
      }
    }

    return {
      enabled: true,
      apiUrl: e.BANANA_GUN_API_URL,
      apiKey: e.BANANA_GUN_API_KEY,
      walletId: e.BANANA_GUN_WALLET_ID,
      amountWei,
      amountEthDisplay: e.BANANA_GUN_BUY_AMOUNT_ETH,
      slippageBps,
      priorityFeeGwei,
      gasMultiplier,
      autoApprove,
      sourceTag: e.BANANA_GUN_SOURCE || 'mempool_scanner',
      extraHeaders
    };
  })();

  return {
    rpcUrls: e.RPC_URLS,
    weth: e.WETH || '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
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
    bananaGun
  };
}

(async () => {
  console.log('🚀 Starting ETH Mempool Scanner (signal mode)...\n');

  const c = cfg();
  const { provider, hasWSS } = await createRobustProvider(c.rpcUrls);

  const telegramBot = c.tgToken && c.tgChat
    ? new TelegramBot(c.tgToken, { polling: false })
    : null;
  const notifier = new EnhancedNotifier(telegramBot, c.tgChat);
  const bananaGunClient = new BananaGunClient(c.bananaGun);

  try {
    const network = await provider.getNetwork();
    const currentBlock = await provider.getBlockNumber();

    console.log(`✅ Connected to ${network.name} at block #${currentBlock}`);
    console.log(`🔌 Provider: ${hasWSS ? 'WebSocket realtime' : 'HTTP fallback'}\n`);

    if (bananaGunClient.enabled) {
      console.log('🍌 Banana Gun auto-buy: ENABLED');
      console.log(`   • Amount: ${c.bananaGun.amountEthDisplay} ETH`);
      console.log(`   • Slippage: ${c.bananaGun.slippageBps} BPS`);
      console.log(`   • Priority fee: ${c.bananaGun.priorityFeeGwei} gwei`);
      console.log(`   • Gas multiplier: ${c.bananaGun.gasMultiplier}\n`);
    } else {
      console.log('🍌 Banana Gun auto-buy: DISABLED (thiếu cấu hình .env)\n');
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

  const signaledTokens = new Set();

  watchMempoolAddLP({
    provider,
    routerList: [c.router],
    factory: c.factory,
    weth: c.weth,
    minLpEth: c.minLP,
    maxLpEth: c.maxLP,

    onCandidate: async ({ token, pair, eth, txHash }) => {
      const tokenLower = token.toLowerCase();
      if (signaledTokens.has(tokenLower)) return;

      const candidateBlock = await provider.getBlockNumber();

      await notifier.notifyCandidate({
        token,
        pair,
        eth,
        blockNumber: candidateBlock,
        txHash
      });

      try {
        const baseTokensPerEth = await basePriceTokensPerEth({
          provider,
          router: c.router,
          token,
          weth: c.weth,
          pair
        });

        if (baseTokensPerEth === 0n) {
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

              retryCount++;
              if (retryCount < maxRetries) {
                console.log(`[price-guard] Retry ${retryCount}/${maxRetries} - waiting 2s...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            } catch (error) {
              retryCount++;
              if (retryCount < maxRetries) {
                console.log(`[price-guard] Query error, retry ${retryCount}/${maxRetries}...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            }
          }

          if (nowTokens === 0n) {
            priceGuardInfo = { status: 'skipped', reason: 'price_unavailable' };
          } else {
            const priceRatio = Number(baseTokensPerEth) / Number(nowTokens);
            const priceChangePercent = ((priceRatio - 1) * 100).toFixed(2);

            console.log(`[price-guard] Base price: ${ethers.formatUnits(baseTokensPerEth, 18)} tokens/ETH`);
            console.log(`[price-guard] Current price: ${ethers.formatUnits(nowTokens, 18)} tokens/ETH`);
            console.log(`[price-guard] Price change: ${priceChangePercent}%`);

            if (nowTokens * BigInt(c.priceMultipleAbort) < baseTokensPerEth) {
              const priceMultiple = Number(baseTokensPerEth) / Number(nowTokens);

              await notifier.notifySkip({
                token, pair,
                reason: `Price increased ${priceMultiple.toFixed(2)}x (limit: ${c.priceMultipleAbort}x)`,
                details: `Possible frontrun detected. Base: ${ethers.formatUnits(baseTokensPerEth, 18)}, Now: ${ethers.formatUnits(nowTokens, 18)} tokens/ETH`,
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

        signaledTokens.add(tokenLower);

        const taxMatch = taxRes.reason?.match(/tax_(\d+)_bps/);
        const taxBps = taxMatch ? Number(taxMatch[1]) : null;

        await notifier.notifySignal({
          token,
          pair,
          blockNumber: candidateBlock,
          lpEth: eth,
          basePriceTokensPerEth,
          taxBps,
          taxDetails: taxRes.details,
          priceGuardInfo,
          bananaGun: bananaGunClient.enabled ? {
            amountEth: c.bananaGun.amountEthDisplay,
            slippageBps: c.bananaGun.slippageBps,
            priorityFeeGwei: c.bananaGun.priorityFeeGwei,
            gasMultiplier: c.bananaGun.gasMultiplier
          } : null
        });

        if (bananaGunClient.enabled) {
          console.log(`🍌 Signal ready for ${token} → auto order submitted to Banana Gun.`);

          try {
            const order = await bananaGunClient.submitBuy({
              token,
              pair,
              blockNumber: candidateBlock,
              lpEth: eth,
              basePriceTokensPerEth,
              taxBps,
              priceGuardInfo
            });

            if (order.success) {
              await notifier.notifyBananaGunOrder({
                token,
                pair,
                amountEth: c.bananaGun.amountEthDisplay,
                blockNumber: candidateBlock,
                status: order.status,
                orderId: order.orderId,
                txHash: order.txHash,
                response: order.response
              });
            } else if (!order.skipped) {
              await notifier.notifyBananaGunOrderError({
                token,
                pair,
                amountEth: c.bananaGun.amountEthDisplay,
                blockNumber: candidateBlock,
                error: order.error,
                response: order.response
              });
            }
          } catch (error) {
            console.error('[BananaGun] Submit failed:', error);
            await notifier.notifyBananaGunOrderError({
              token,
              pair,
              amountEth: c.bananaGun.amountEthDisplay,
              blockNumber: candidateBlock,
              error: error.message
            });
          }
        } else {
          console.log(`🍌 Signal ready for ${token} → copy the address into Banana Gun to trade.`);
        }
      } catch (e) {
        console.error('Candidate processing error:', e);
        await notifier.send(`⚠️ ERROR: ${token.slice(0,10)}... - ${e.message}`);
      }
    }
  });

  process.on('SIGINT', async () => {
    console.log('\n⏹️  Shutting down scanner...');
    await notifier.notifyShutdown({ reason: 'Manual shutdown (Ctrl+C)' });
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
