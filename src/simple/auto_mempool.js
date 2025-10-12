import 'dotenv/config';
import { ethers } from 'ethers';
import TelegramBot from 'node-telegram-bot-api';
import { watchMempoolAddLP } from './mempoolAddLPWatcher.js';
import { enforceStrictTax, rejectBySelectors, basePriceTokensPerEth, canBuyCallStatic } from './filters.js';
import { buyExactETH, checkTradingEnabled } from './buy.js';
import { sellAll } from './sell.js';
import { watchRugDefense } from './rugWatcher.js';
import { createRobustProvider } from './providerSelector.js';
import { EnhancedNotifier, formatHoldTime, calculateGasCost } from './enhancedNotifier.js';
import { priceTokensForEth } from './pricing.js';

function cfg(){
  const e = process.env;
  if (!e.RPC_URLS) throw new Error('❌ RPC_URLS missing');
  
  return {
    rpcUrls: e.RPC_URLS,
    weth: e.WETH || '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    router: e.ROUTER_V2 || '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    factory: e.FACTORY_V2 || '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    pk: e.PRIVATE_KEY,
    minLP: Number(e.MIN_LP_ETH||'0.5'),
    maxLP: Number(e.MAX_LP_ETH||'1'),
    taxMax: Number(e.STRICT_TAX_BPS_MAX||'0'),
    taxMode: (e.STRICT_TAX_MODE||'reject_unknown'),
    blocked: e.BLOCKLIST_SELECTORS || '',
    buyWei: e.BUY_ETH ? ethers.parseEther(String(e.BUY_ETH)) : ethers.parseEther('0.01'),
    priceGuard: Number(e.PRICE_GUARD||'1')===1,
    priceMultipleAbort: Number(e.PRICE_MULTIPLE_ABORT||'3'),
    tpPct: Number(e.TP_PCT||'20'),
    timeoutSec: Number(e.TP_TIMEOUT_SEC||'600'),
    rugDefense: Number(e.RUG_DEFENSE||'1')===1,
    rugBp: Number(e.RUG_THRESHOLD_BP||'2000'),
    testWei: e.HONEYPOT_TEST_WEI ? ethers.parseEther(String(e.HONEYPOT_TEST_WEI)) : 0n,
    tgToken: e.TELEGRAM_TOKEN||e.TELEGRAM_BOT_TOKEN||'',
    tgChat: e.TELEGRAM_CHAT_ID||''
  };
}

// ═══════════════════════════════════════════════════════════════
// 📊 TRADE TRACKER với gas tracking
// ═══════════════════════════════════════════════════════════════
class TradeTracker {
  constructor() {
    this.trades = new Map();
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      totalProfitETH: 0,
      totalLossETH: 0,
      totalGasETH: 0,
      blockDelays: [],
      holdTimes: []
    };
  }

  startTrade(token, data) {
    this.trades.set(token.toLowerCase(), {
      ...data,
      startTime: Date.now()
    });
    this.stats.total++;
  }

  updateTrade(token, updates) {
    const trade = this.trades.get(token.toLowerCase());
    if (trade) Object.assign(trade, updates);
  }

  completeTrade(token, result) {
    const trade = this.trades.get(token.toLowerCase());
    if (!trade) return;

    Object.assign(trade, result);
    
    if (result.netProfitETH !== undefined) {
      if (result.netProfitETH >= 0) {
        this.stats.success++;
        this.stats.totalProfitETH += parseFloat(result.netProfitETH);
      } else {
        this.stats.failed++;
        this.stats.totalLossETH += Math.abs(parseFloat(result.netProfitETH));
      }
    }

    if (result.totalGasETH) {
      this.stats.totalGasETH += parseFloat(result.totalGasETH);
    }

    if (result.blockDelay !== undefined) {
      this.stats.blockDelays.push(result.blockDelay);
    }

    if (result.holdTimeSec) {
      this.stats.holdTimes.push(result.holdTimeSec);
    }
  }

  getStats() {
    const avgBlockDelay = this.stats.blockDelays.length 
      ? (this.stats.blockDelays.reduce((a,b)=>a+b,0) / this.stats.blockDelays.length).toFixed(1)
      : '0';
    
    const fastestBlock = this.stats.blockDelays.length
      ? Math.min(...this.stats.blockDelays)
      : 0;

    const avgHoldTime = this.stats.holdTimes.length
      ? formatHoldTime(Math.floor(this.stats.holdTimes.reduce((a,b)=>a+b,0) / this.stats.holdTimes.length))
      : '0s';

    const netProfitETH = (this.stats.totalProfitETH - this.stats.totalLossETH - this.stats.totalGasETH).toFixed(4);
    const winRate = this.stats.total > 0 
      ? ((this.stats.success / this.stats.total) * 100).toFixed(1)
      : '0';

    return {
      totalTrades: this.stats.total,
      successful: this.stats.success,
      failed: this.stats.failed,
      totalProfitETH: this.stats.totalProfitETH.toFixed(4),
      totalLossETH: this.stats.totalLossETH.toFixed(4),
      totalGasETH: this.stats.totalGasETH.toFixed(4),
      netProfitETH,
      winRate,
      avgBlockDelay,
      fastestBlock,
      avgHoldTime
    };
  }
}

(async () => {
  console.log('🚀 Starting ETH Mempool Sniper Bot...\n');

  const c = cfg();
  const { provider, hasWSS } = await createRobustProvider(c.rpcUrls);
  const wallet = new ethers.Wallet(c.pk, provider);
  
  // ✅ Enhanced Notifier
  const telegramBot = c.tgToken && c.tgChat 
    ? new TelegramBot(c.tgToken, { polling: false })
    : null;
  const notifier = new EnhancedNotifier(telegramBot, c.tgChat);
  const tracker = new TradeTracker();

  try {
    const addr = await wallet.getAddress();
    const balance = await provider.getBalance(addr);
    const network = await provider.getNetwork();
    const currentBlock = await provider.getBlockNumber();
    
    console.log(`✅ Connected to ${network.name} at block #${currentBlock}`);
    console.log(`👛 Wallet: ${addr}`);
    console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH\n`);

    await notifier.notifyBoot({
      network: network.name,
      chainId: network.chainId.toString(),
      wallet: addr,
      balance: ethers.formatEther(balance),
      hasWSS,
      settings: {
        minLP: c.minLP,
        maxLP: c.maxLP,
        buyETH: ethers.formatEther(c.buyWei),
        taxMax: c.taxMax,
        tpPct: c.tpPct,
        timeout: c.timeoutSec,
        priceMultiple: c.priceMultipleAbort,
        rugDefense: c.rugDefense
      }
    });

  } catch (e) {
    console.error('❌ Boot failed:', e.message);
    process.exit(1);
  }

  const activePositions = new Map();

  watchMempoolAddLP({
    provider,
    routerList: [c.router],
    factory: c.factory,
    weth: c.weth,
    minLpEth: c.minLP,
    maxLpEth: c.maxLP,
    
    onCandidate: async ({ token, pair, eth }) => {
      const tokenLower = token.toLowerCase();
      
      if (activePositions.has(tokenLower)) return;

      // Get current block for tracking
      const candidateBlock = await provider.getBlockNumber();
      const candidateTime = Date.now();

      await notifier.notifyCandidate({
        token,
        pair,
        eth,
        blockNumber: candidateBlock
      });

      try {
        // ═══════════════════════════════════════════════════════════════
        // STEP 1: Base Price
        // ═══════════════════════════════════════════════════════════════
        
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

        // ═══════════════════════════════════════════════════════════════
        // STEP 2: Tax Check
        // ═══════════════════════════════════════════════════════════════
        
        const taxRes = await enforceStrictTax({ 
          provider, 
          token, 
          strictMaxBps: c.taxMax, 
          mode: c.taxMode,
          router: c.router,
          weth: c.weth,
          pair: pair
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
        
        if (taxRes.reason.includes('tax_') && !taxRes.reason.includes('unknown')) {
          const taxMatch = taxRes.reason.match(/tax_(\d+)_bps/);
          if (taxMatch) {
            const taxBps = parseInt(taxMatch[1]);
            console.log(`[filters] ✅ Tax detected: ${taxBps} BPS (${(taxBps/100).toFixed(2)}%)`);
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 3: Blocked Selectors
        // ═══════════════════════════════════════════════════════════════
        
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

        // ═══════════════════════════════════════════════════════════════
        // STEP 4: Honeypot Test (Optional)
        // ═══════════════════════════════════════════════════════════════
        
        if (c.testWei > 0n) {
          try {
            const testTx = await buyExactETH({ 
              router: c.router, 
              weth: c.weth, 
              token, 
              wallet, 
              amountWei: c.testWei 
            });
            await testTx.wait(1);
            
            const { sold } = await sellAll({ 
              router: c.router, 
              token, 
              weth: c.weth, 
              wallet 
            });
            
            if (!sold) {
              await notifier.notifySkip({
                token, pair,
                reason: 'Honeypot suspected',
                details: 'Test buy OK but cannot sell back',
                blockNumber: candidateBlock,
                lpEth: eth
              });
              return;
            }
          } catch(e) {
            await notifier.notifySkip({
              token, pair,
              reason: 'Honeypot test failed',
              details: e.message,
              blockNumber: candidateBlock,
              lpEth: eth
            });
            return;
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 5: Price Guard
        // ═══════════════════════════════════════════════════════════════
        
        if (c.priceGuard) {
          try {
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
                
                if (nowTokens > 0n) {
                  break;
                }
                
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
              console.log(`[price-guard] ⚠️  Cannot get current price after ${maxRetries} retries`);
              console.log(`[price-guard] ⚠️  Skipping price guard check (risky but proceeding)`);
              
              await notifier.send(
                `⚠️ WARNING: Price Guard Skipped\n` +
                `🪙 Token: ${token.slice(0,10)}...\n` +
                `📍 Pair: ${pair.slice(0,10)}...\n` +
                `⚠️ Cannot query price - proceeding anyway (HIGH RISK)`
              );
              
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
              
              if (priceRatio > 1.5 && priceRatio < c.priceMultipleAbort) {
                console.log(`[price-guard] ⚠️  Price increased ${(priceRatio * 100).toFixed(0)}% - close to limit but proceeding`);
                
                await notifier.send(
                  `⚠️ Price Guard Warning\n` +
                  `🪙 Token: ${token.slice(0,10)}...\n` +
                  `📈 Price increased: ${(priceRatio * 100).toFixed(0)}%\n` +
                  `⚠️ Close to abort threshold (${c.priceMultipleAbort}x)`
                );
              }
              
              console.log(`[price-guard] ✅ Price check passed`);
            }
            
          } catch (error) {
            console.error(`[price-guard] ❌ Error in price guard:`, error.message);
            console.log(`[price-guard] ⚠️  Proceeding without price guard (HIGH RISK)`);
            
            await notifier.send(
              `⚠️ Price Guard Error\n` +
              `🪙 Token: ${token.slice(0,10)}...\n` +
              `❌ Error: ${error.message}\n` +
              `⚠️ Proceeding anyway (HIGH RISK)`
            );
          }
        } else {
          console.log(`[price-guard] ⏭️  Price guard disabled in config`);
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 6: Can Buy Check
        // ═══════════════════════════════════════════════════════════════
        
        const canBuy = await canBuyCallStatic({ 
          provider, 
          router: c.router, 
          weth: c.weth, 
          token, 
          from: await wallet.getAddress(), 
          wei: c.buyWei / 10n 
        });
        
        if (!canBuy) {
          await notifier.notifySkip({
            token, pair,
            reason: 'Buy simulation failed',
            details: 'callStatic reverted - trading might not be open',
            blockNumber: candidateBlock,
            lpEth: eth
          });
          return;
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 6.5: Check Trading Enabled
        // ═══════════════════════════════════════════════════════════════

        console.log('[trading-check] Verifying trading is enabled...');

        const tradingCheck = await checkTradingEnabled({
          provider,
          router: c.router,
          weth: c.weth,
          token,
          testAmount: c.buyWei / 100n
        });

        if (!tradingCheck.enabled) {
          await notifier.notifySkip({
            token, pair,
            reason: 'Trading not enabled',
            details: `Check failed: ${tradingCheck.reason}. Liquidity might not be locked yet.`,
            blockNumber: candidateBlock,
            lpEth: eth
          });
          return;
        }

        console.log(`[trading-check] ✅ Trading enabled (method: ${tradingCheck.method})`);

        // ═══════════════════════════════════════════════════════════════
        // 🎯 EXECUTE BUY
        // ═══════════════════════════════════════════════════════════════
        
        const expectedBlock = await provider.getBlockNumber();

        await notifier.notifyBuyAttempt({
          token, pair,
          amountETH: c.buyWei,
          expectedBlock,
          basePrice: `${ethers.formatUnits(baseTokensPerEth, 18)} tokens/ETH`
        });

        let buyTx, buyReceipt, tokenBalance, decimals;

        try {
          buyTx = await buyExactETH({ 
            router: c.router, 
            weth: c.weth, 
            token, 
            wallet, 
            amountWei: c.buyWei
          });
          
          console.log('[buy] ⏳ Waiting for confirmation...');
          buyReceipt = await buyTx.wait(1);
          
          if (!buyReceipt || buyReceipt.status !== 1) {
            throw new Error('Transaction reverted after mining');
          }

          const tokenContract = new ethers.Contract(
            token,
            ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'],
            provider
          );
          
          tokenBalance = await tokenContract.balanceOf(await wallet.getAddress());
          decimals = await tokenContract.decimals().catch(() => 18);
          
          const gasUsed = buyReceipt.gasUsed;
          const effectiveGasPrice = buyReceipt.gasPrice || buyReceipt.effectiveGasPrice || 0n;
          const gasCostETH = calculateGasCost(gasUsed, effectiveGasPrice);
          const totalCostETH = (parseFloat(ethers.formatEther(c.buyWei)) + parseFloat(gasCostETH)).toFixed(6);
          
          const buyBlock = buyReceipt.blockNumber;
          const blockDelay = buyBlock - candidateBlock;
          const timeTaken = ((Date.now() - candidateTime) / 1000).toFixed(2);

          tracker.startTrade(token, {
            pair,
            candidateBlock,
            buyBlock,
            blockDelay,
            buyTxHash: buyTx.hash,
            costETH: ethers.formatEther(c.buyWei),
            buyGasCostETH: gasCostETH,
            totalCostETH,
            tokensReceived: tokenBalance,
            decimals
          });

          await notifier.notifyBuySuccess({
            token,
            pair,
            tokensReceived: tokenBalance,
            decimals,
            costETH: c.buyWei,
            buyPrice: `${ethers.formatUnits(baseTokensPerEth, decimals)} tokens/ETH`,
            txHash: buyTx.hash,
            blockNumber: buyBlock,
            gasUsed: Number(gasUsed),
            effectiveGasPrice,
            gasCostETH,
            totalCostETH,
            candidateBlock,
            timeTaken
          });

        } catch (e) {
          const errorMsg = e.message || 'Unknown error';
          let suggestion = 'Unknown issue';
          
          if (errorMsg.includes('Trading not enabled')) {
            suggestion = 'Wait for deployer to enable trading or add more liquidity';
          } else if (errorMsg.includes('Slippage')) {
            suggestion = 'Increase SLIPPAGE_BPS in config or try again';
          } else if (errorMsg.includes('gas')) {
            suggestion = 'Increase gas settings or wait for lower network congestion';
          } else if (errorMsg.includes('insufficient')) {
            suggestion = 'Top up ETH balance';
          } else if (errorMsg.includes('Blacklist')) {
            suggestion = 'Token has blacklist - cannot trade from this address';
          } else if (errorMsg.includes('Max')) {
            suggestion = 'Reduce BUY_ETH amount - exceeds max transaction limit';
          }
          
          await notifier.notifyBuyFail({
            token, pair,
            error: errorMsg,
            suggestion,
            blockNumber: await provider.getBlockNumber()
          });
          
          return;
        }

        // ═══════════════════════════════════════════════════════════════
        // 🛡️ RUG DEFENSE
        // ═══════════════════════════════════════════════════════════════
        
        let rugHandle = null;
        if (c.rugDefense && provider instanceof ethers.WebSocketProvider) {
          rugHandle = watchRugDefense({
            provider, 
            pair,
            routers: [c.router],
            thresholdBp: c.rugBp,
            
            onThreat: async ({ kind, hash }) => {
              const currentBlock = await provider.getBlockNumber();
              
              await notifier.notifyRugAlert({
                token, pair, kind,
                rugTxHash: hash,
                blockNumber: currentBlock
              });

              try {
                console.log('[rug] 🚨 Executing PANIC SELL...');
                
                const sellTx = await sellAll({ 
                  router: c.router, 
                  token, 
                  weth: c.weth, 
                  wallet,
                  isPanic: true
                });
                
                if (sellTx.sold) {
                  const sellReceipt = await provider.getTransactionReceipt(sellTx.hash);
                  
                  const sellGasUsed = sellReceipt.gasUsed;
                  const sellEffectiveGasPrice = sellReceipt.gasPrice || sellReceipt.effectiveGasPrice || 0n;
                  const sellGasCostETH = calculateGasCost(sellGasUsed, sellEffectiveGasPrice);
                  
                  const trade = tracker.trades.get(tokenLower);
                  const totalGasETH = (parseFloat(trade.buyGasCostETH) + parseFloat(sellGasCostETH)).toFixed(6);
                  
                  await notifier.send(
                    `✅ PANIC SELL EXECUTED\n` +
                    `🔗 TX: ${sellTx.hash}\n` +
                    `⛽ Gas: ${sellGasCostETH} ETH\n` +
                    `💸 Total gas cost: ${totalGasETH} ETH`
                  );
                  
                  tracker.completeTrade(token, {
                    sellReason: `Rug: ${kind}`,
                    totalGasETH,
                    isPanicSell: true
                  });
                }

                rugHandle?.stop?.();
                activePositions.delete(tokenLower);

              } catch (e) {
                await notifier.send(`⚠️ PANIC SELL FAILED: ${e.message}`);
              }
            }
          });
        }

        // ═══════════════════════════════════════════════════════════════
        // 📊 POSITION MONITORING
        // ═══════════════════════════════════════════════════════════════
        
        const buyStartTime = Date.now();
        const trade = tracker.trades.get(tokenLower);
        
        const monitorInterval = setInterval(async () => {
          try {
            const currentBalance = await (new ethers.Contract(
              token,
              ['function balanceOf(address) view returns (uint256)'],
              provider
            )).balanceOf(await wallet.getAddress());

            if (currentBalance === 0n) {
              clearInterval(monitorInterval);
              rugHandle?.stop?.();
              activePositions.delete(tokenLower);
              return;
            }

            const currentValueWei = await priceTokensForEth({ 
              provider, 
              router: c.router, 
              token, 
              weth: c.weth, 
              amountIn: currentBalance 
            });

            if (currentValueWei === 0n) return;

            const costWei = c.buyWei;
            const profitWei = currentValueWei - costWei;
            const profitPct = Number(profitWei * 10000n / costWei) / 100;
            const holdTimeSec = Math.floor((Date.now() - buyStartTime) / 1000);
            const holdTimeStr = formatHoldTime(holdTimeSec);

            let shouldSell = false;
            let sellReason = '';

            if (profitPct >= c.tpPct) {
              shouldSell = true;
              sellReason = `TP Hit: +${profitPct.toFixed(2)}%`;
            } else if (holdTimeSec >= c.timeoutSec) {
              shouldSell = true;
              sellReason = `Timeout: ${holdTimeStr}`;
            }

            if (shouldSell) {
              clearInterval(monitorInterval);

              await notifier.notifySellTrigger({
                token, pair,
                reason: sellReason,
                profitPct,
                holdTime: holdTimeStr,
                currentValueETH: ethers.formatEther(currentValueWei)
              });

              try {
                const sellResult = await sellAll({ 
                  router: c.router, 
                  token, 
                  weth: c.weth, 
                  wallet 
                });

                if (sellResult.sold) {
                  const sellReceipt = await provider.getTransactionReceipt(sellResult.hash);
                  const sellBlock = sellReceipt.blockNumber;
                  
                  const sellGasUsed = sellReceipt.gasUsed;
                  const sellEffectiveGasPrice = sellReceipt.gasPrice || sellReceipt.effectiveGasPrice || 0n;
                  const sellGasCostETH = calculateGasCost(sellGasUsed, sellEffectiveGasPrice);
                  
                  const totalGasETH = (parseFloat(trade.buyGasCostETH) + parseFloat(sellGasCostETH)).toFixed(6);
                  
                  const profitETH = ethers.formatEther(profitWei);
                  const netProfitETH = (parseFloat(profitETH) - parseFloat(totalGasETH)).toFixed(6);

                  await notifier.notifySellSuccess({
                    token, pair,
                    tokensSold: currentBalance,
                    decimals,
                    ethReceived: ethers.formatEther(currentValueWei),
                    profitPct,
                    profitETH,
                    holdTime: holdTimeStr,
                    txHash: sellResult.hash,
                    blockNumber: sellBlock,
                    gasUsed: Number(sellGasUsed),
                    effectiveGasPrice: sellEffectiveGasPrice,
                    gasCostETH: sellGasCostETH,
                    netProfitETH,
                    buyBlockNumber: trade.buyBlock,
                    totalGasETH
                  });

                  tracker.completeTrade(token, {
                    sellBlock,
                    netProfitETH,
                    totalGasETH,
                    holdTimeSec,
                    sellReason
                  });

                  if (tracker.stats.total % 5 === 0) {
                    await notifier.notifyStats(tracker.getStats());
                  }

                } else {
                  await notifier.notifySellFail({
                    token, pair,
                    error: sellResult.reason || 'Unknown error',
                    willRetry: false
                  });
                }

                rugHandle?.stop?.();
                activePositions.delete(tokenLower);

              } catch (e) {
                await notifier.notifySellFail({
                  token, pair,
                  error: e.message,
                  willRetry: false
                });
              }
            }

          } catch (e) {
            console.error(`Monitor error for ${token}:`, e.message);
          }
        }, 2000);

        activePositions.set(tokenLower, {
          rugHandle,
          monitorInterval,
          buyTime: buyStartTime
        });

      } catch (e) {
        console.error('Candidate processing error:', e);
        await notifier.send(`⚠️ ERROR: ${token.slice(0,10)}... - ${e.message}`);
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 🛑 GRACEFUL SHUTDOWN
  // ═══════════════════════════════════════════════════════════════
  
  process.on('SIGINT', async () => {
    console.log('\n⏹️  Shutting down...');
    
    await notifier.notifyShutdown({
      activePositions: activePositions.size,
      reason: 'Manual shutdown (Ctrl+C)'
    });

    for (const [token, handles] of activePositions) {
      try {
        clearInterval(handles.monitorInterval);
        handles.rugHandle?.stop?.();
        
        const { sold } = await sellAll({ 
          router: c.router, 
          token, 
          weth: c.weth, 
          wallet 
        });
        
        if (sold) {
          console.log(`✅ Closed ${token.slice(0,10)}...`);
        }
      } catch (e) {
        console.error(`Failed to close ${token}:`, e.message);
      }
    }

    await notifier.notifyStats(tracker.getStats());
    await notifier.send('👋 Bot stopped completely');

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