import { ethers } from 'ethers';

/**
 * 📱 Enhanced Notification System
 * Đáp ứng 5 yêu cầu:
 * 1. Block number khi mua
 * 2. Gas fees chi tiết
 * 3. Dexscreener link
 * 4. Thông báo cả pair bị reject
 * 5. Chỉ thông báo khi có AddLP (không báo token mới chưa LP)
 */

export class EnhancedNotifier {
  constructor(telegramBot, chatId) {
    this.bot = telegramBot;
    this.chatId = chatId;
    this.enabled = telegramBot && chatId;
  }

  async send(message) {
    if (!this.enabled) return;
    try {
      await this.bot.sendMessage(this.chatId, message, { 
        disable_web_page_preview: true,
        parse_mode: 'HTML'
      });
    } catch (e) {
      console.error('[Notifier] Send failed:', e.message);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 🔍 CANDIDATE DETECTED (Yêu cầu #5: Chỉ khi có AddLP)
  // ════════════════════════════════════════════════════════════
  async notifyCandidate({ token, pair, eth, blockNumber, txHash }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;
    const etherscan = `https://etherscan.io/address/${token}`;
    
    const msg = `🔍 <b>CANDIDATE DETECTED</b>
━━━━━━━━━━━━━━━━
📍 Pair: <code>${pair.slice(0,8)}...${pair.slice(-6)}</code>
🪙 Token: <code>${token.slice(0,8)}...${token.slice(-6)}</code>
💧 LP: <b>${eth.toFixed(4)} ETH</b>
📦 Block: <b>#${blockNumber}</b>

🔗 <a href="${dexscreener}">Dexscreener</a>
🔗 <a href="${etherscan}">Etherscan</a>
${txHash ? `🔗 <a href="https://etherscan.io/tx/${txHash}">AddLP TX</a>` : ''}

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  // ════════════════════════════════════════════════════════════
  // ⏭️ SKIP / REJECT (Yêu cầu #4: Thông báo cả pair bị reject)
  // ════════════════════════════════════════════════════════════
  async notifySkip({ token, pair, reason, details, blockNumber, lpEth }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;
    
    const msg = `⏭️ <b>SKIPPED</b>
━━━━━━━━━━━━━━━━
🪙 Token: <code>${token.slice(0,8)}...${token.slice(-6)}</code>
💧 LP: ${lpEth ? `${lpEth.toFixed(4)} ETH` : 'N/A'}
📦 Block: ${blockNumber ? `#${blockNumber}` : 'N/A'}

❌ <b>Lý do:</b> ${reason}
${details ? `📝 Chi tiết: ${details}` : ''}

🔗 <a href="${dexscreener}">View on Dexscreener</a>

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  // ════════════════════════════════════════════════════════════
  // 🎯 BUY ATTEMPT
  // ════════════════════════════════════════════════════════════
  async notifyBuyAttempt({ token, pair, amountETH, expectedBlock, basePrice }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;
    
    const msg = `🎯 <b>BUYING...</b>
━━━━━━━━━━━━━━━━
🪙 Token: <code>${token.slice(0,10)}...</code>
💰 Amount: <b>${ethers.formatEther(amountETH)} ETH</b>
📈 Base Price: ${basePrice}
📦 Target Block: ~#${expectedBlock}

🔗 <a href="${dexscreener}">Dexscreener</a>

⏳ Waiting for confirmation...`;

    await this.send(msg);
  }

  // ════════════════════════════════════════════════════════════
  // ✅ BUY SUCCESS (Yêu cầu #1, #2, #3)
  // ════════════════════════════════════════════════════════════
  async notifyBuySuccess({ 
    token, 
    pair,
    tokensReceived, 
    decimals,
    costETH, 
    buyPrice,
    txHash,
    blockNumber,        // ✅ Yêu cầu #1: Block khi mua
    gasUsed,           // ✅ Yêu cầu #2: Gas fees
    effectiveGasPrice,
    gasCostETH,
    totalCostETH,      // cost + gas
    candidateBlock,    // Block phát hiện candidate
    timeTaken
  }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`; // ✅ Yêu cầu #3
    const etherscanTx = `https://etherscan.io/tx/${txHash}`;
    const etherscanToken = `https://etherscan.io/address/${token}`;
    
    // ✅ Yêu cầu #1: Tính block delay
    const blockDelay = candidateBlock ? blockNumber - candidateBlock : 0;
    
    const msg = `✅ <b>BUY SUCCESS</b>
━━━━━━━━━━━━━━━━
🪙 Token: <code>${token.slice(0,8)}...${token.slice(-6)}</code>
📦 Amount: <b>${ethers.formatUnits(tokensReceived, decimals)}</b>

💰 <b>Cost Breakdown:</b>
  • Token Cost: ${ethers.formatEther(costETH)} ETH
  • Gas Used: ${gasUsed.toLocaleString()}
  • Gas Price: ${ethers.formatUnits(effectiveGasPrice, 'gwei')} Gwei
  • Gas Cost: <b>${gasCostETH} ETH</b>
  • <b>Total Cost: ${totalCostETH} ETH</b>

📊 <b>Execution Stats:</b>
  • Detected at Block: #${candidateBlock || 'N/A'}
  • Bought at Block: <b>#${blockNumber}</b>
  • Block Delay: <b>${blockDelay} blocks</b>
  • Time Taken: ${timeTaken}s

📈 Buy Price: ${buyPrice}

🔗 <a href="${dexscreener}">Dexscreener</a>
🔗 <a href="${etherscanTx}">Buy TX</a>
🔗 <a href="${etherscanToken}">Token Contract</a>

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  // ════════════════════════════════════════════════════════════
  // ❌ BUY FAILED
  // ════════════════════════════════════════════════════════════
  async notifyBuyFail({ token, pair, error, suggestion, blockNumber }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;
    
    const msg = `❌ <b>BUY FAILED</b>
━━━━━━━━━━━━━━━━
🪙 Token: <code>${token.slice(0,10)}...</code>
📦 Block: ${blockNumber ? `#${blockNumber}` : 'N/A'}

❗ <b>Error:</b> ${error}
${suggestion ? `💡 <b>Suggestion:</b> ${suggestion}` : ''}

🔗 <a href="${dexscreener}">Dexscreener</a>

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  // ════════════════════════════════════════════════════════════
  // 🔔 SELL TRIGGER
  // ════════════════════════════════════════════════════════════
  async notifySellTrigger({ token, pair, reason, profitPct, holdTime, currentValueETH }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;
    
    const profitEmoji = profitPct >= 0 ? '📈' : '📉';
    const profitColor = profitPct >= 0 ? '+' : '';
    
    const msg = `🔔 <b>SELL TRIGGERED</b>
━━━━━━━━━━━━━━━━
🪙 Token: <code>${token.slice(0,10)}...</code>
📊 Reason: <b>${reason}</b>

💹 Current P&L: ${profitEmoji} <b>${profitColor}${profitPct.toFixed(2)}%</b>
💰 Current Value: ${currentValueETH} ETH
⏱️ Hold Time: ${holdTime}

🔗 <a href="${dexscreener}">Dexscreener</a>

⏳ Executing sell...`;

    await this.send(msg);
  }

  // ════════════════════════════════════════════════════════════
  // 💰 SELL SUCCESS (Yêu cầu #2: Gas fees)
  // ════════════════════════════════════════════════════════════
  async notifySellSuccess({
    token,
    pair,
    tokensSold,
    decimals,
    ethReceived,
    profitPct,
    profitETH,
    holdTime,
    txHash,
    blockNumber,
    // ✅ Yêu cầu #2: Gas fees cho sell
    gasUsed,
    effectiveGasPrice,
    gasCostETH,
    netProfitETH,      // profit - gas
    buyBlockNumber,
    totalGasETH        // Buy gas + Sell gas
  }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;
    const etherscanTx = `https://etherscan.io/tx/${txHash}`;
    
    const profitEmoji = profitPct >= 0 ? '💰' : '📉';
    const profitSign = profitPct >= 0 ? '+' : '';
    const netProfitSign = netProfitETH >= 0 ? '+' : '';
    
    const msg = `${profitEmoji} <b>SELL SUCCESS</b>
━━━━━━━━━━━━━━━━
🪙 Token: <code>${token.slice(0,8)}...${token.slice(-6)}</code>
📦 Sold: ${ethers.formatUnits(tokensSold, decimals)}

💵 <b>Returns:</b>
  • ETH Received: ${ethReceived} ETH
  • Gross P&L: ${profitSign}${profitETH} ETH (${profitSign}${profitPct.toFixed(2)}%)

💸 <b>Gas Costs:</b>
  • Sell Gas: ${gasUsed.toLocaleString()} @ ${ethers.formatUnits(effectiveGasPrice, 'gwei')} Gwei
  • Sell Gas Cost: ${gasCostETH} ETH
  • Total Gas (Buy+Sell): <b>${totalGasETH} ETH</b>

💹 <b>Net P&L: ${netProfitSign}${netProfitETH} ETH</b>

📊 <b>Trade Summary:</b>
  • Buy Block: #${buyBlockNumber}
  • Sell Block: #${blockNumber}
  • Hold Time: ${holdTime}
  • Blocks Held: ${blockNumber - buyBlockNumber}

🔗 <a href="${dexscreener}">Dexscreener</a>
🔗 <a href="${etherscanTx}">Sell TX</a>

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  // ════════════════════════════════════════════════════════════
  // ⚠️ SELL FAILED
  // ════════════════════════════════════════════════════════════
  async notifySellFail({ token, pair, error, willRetry }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;
    
    const msg = `⚠️ <b>SELL FAILED</b>
━━━━━━━━━━━━━━━━
🪙 Token: <code>${token.slice(0,10)}...</code>

❗ <b>Error:</b> ${error}
${willRetry ? '🔄 Will retry...' : '⛔ No more retries'}

🔗 <a href="${dexscreener}">Dexscreener</a>

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  // ════════════════════════════════════════════════════════════
  // 🚨 RUG ALERT
  // ════════════════════════════════════════════════════════════
  async notifyRugAlert({ token, pair, kind, rugTxHash, blockNumber }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;
    const rugTx = `https://etherscan.io/tx/${rugTxHash}`;
    
    const msg = `🚨 <b>RUG PULL DETECTED</b>
━━━━━━━━━━━━━━━━
🪙 Token: <code>${token.slice(0,10)}...</code>
⚠️ Type: <b>${kind}</b>
📦 Block: #${blockNumber}

🔗 <a href="${rugTx}">Rug Transaction</a>
🔗 <a href="${dexscreener}">Dexscreener</a>

⚡ <b>EMERGENCY SELL EXECUTING...</b>`;

    await this.send(msg);
  }

  // ════════════════════════════════════════════════════════════
  // 📊 STATISTICS
  // ════════════════════════════════════════════════════════════
  async notifyStats({ 
    totalTrades, 
    successful, 
    failed, 
    totalProfitETH,
    totalLossETH,
    totalGasETH,
    netProfitETH,
    winRate,
    avgBlockDelay,
    fastestBlock,
    avgHoldTime
  }) {
    const netSign = netProfitETH >= 0 ? '+' : '';
    const emoji = netProfitETH >= 0 ? '📈' : '📉';
    
    const msg = `📊 <b>BOT STATISTICS</b>
━━━━━━━━━━━━━━━━
📈 <b>Trades:</b>
  • Total: ${totalTrades}
  • Success: ${successful}
  • Failed: ${failed}
  • Win Rate: <b>${winRate}%</b>

💰 <b>P&L:</b>
  • Gross Profit: +${totalProfitETH} ETH
  • Gross Loss: ${totalLossETH} ETH
  • Total Gas: ${totalGasETH} ETH
  • <b>Net P&L: ${netSign}${netProfitETH} ETH</b>

⚡ <b>Performance:</b>
  • Avg Block Delay: ${avgBlockDelay} blocks
  • Fastest Snipe: ${fastestBlock} blocks
  • Avg Hold Time: ${avgHoldTime}

${emoji} <b>${netProfitETH >= 0 ? 'PROFITABLE' : 'IN LOSS'}</b>

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  // ════════════════════════════════════════════════════════════
  // 🚀 BOOT MESSAGE
  // ════════════════════════════════════════════════════════════
  async notifyBoot({ 
    network, 
    chainId, 
    wallet, 
    balance, 
    hasWSS, 
    settings 
  }) {
    const msg = `🚀 <b>BOT STARTED</b>
━━━━━━━━━━━━━━━━
🌐 Network: ${network} (${chainId})
👛 Wallet: <code>${wallet.slice(0,8)}...${wallet.slice(-6)}</code>
💰 Balance: <b>${balance} ETH</b>
🔌 RPC: ${hasWSS ? 'WebSocket ✅' : 'HTTP (Fallback) ⚠️'}

⚙️ <b>Settings:</b>
  • LP Range: ${settings.minLP}-${settings.maxLP} ETH
  • Buy Amount: ${settings.buyETH} ETH
  • Tax Max: ${settings.taxMax} BPS
  • TP: ${settings.tpPct}% | Timeout: ${settings.timeout}s
  • Price Guard: ${settings.priceMultiple}x
  • Rug Defense: ${settings.rugDefense ? 'ON' : 'OFF'}

━━━━━━━━━━━━━━━━
✅ <b>Ready to snipe...</b>

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  // ════════════════════════════════════════════════════════════
  // 🛑 SHUTDOWN
  // ════════════════════════════════════════════════════════════
  async notifyShutdown({ activePositions, reason }) {
    const msg = `🛑 <b>BOT STOPPING</b>
━━━━━━━━━━━━━━━━
⏱️ Active Positions: ${activePositions}
${reason ? `📝 Reason: ${reason}` : ''}

${activePositions > 0 ? '⚠️ Closing all positions...' : '✅ No open positions'}

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }
}

// ════════════════════════════════════════════════════════════
// 🛠️ HELPER: Format hold time
// ════════════════════════════════════════════════════════════
export function formatHoldTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// ════════════════════════════════════════════════════════════
// 🛠️ HELPER: Calculate gas cost in ETH
// ════════════════════════════════════════════════════════════
export function calculateGasCost(gasUsed, effectiveGasPrice) {
  const gasCostWei = BigInt(gasUsed) * BigInt(effectiveGasPrice);
  return ethers.formatEther(gasCostWei);
}