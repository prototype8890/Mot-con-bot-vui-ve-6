import { ethers } from 'ethers';

const LEVEL_EMOJI = {
  INFO: 'ℹ️',
  SUCCESS: '✅',
  WARNING: '⚠️',
  CRITICAL: '🛑'
};

function formatDateTime(timestamp) {
  if (!timestamp) return 'N/A';
  const date = new Date(Number(timestamp) * 1000);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString('vi-VN');
}

export class EnhancedNotifier {
  constructor(telegramBot, chatId) {
    this.bot = telegramBot;
    this.chatId = chatId;
    this.enabled = Boolean(telegramBot && chatId);
  }

  async send(message) {
    if (!this.enabled) return;
    try {
      await this.bot.sendMessage(this.chatId, message, {
        disable_web_page_preview: true,
        parse_mode: 'HTML'
      });
    } catch (error) {
      console.error('[Notifier] Send failed:', error.message);
    }
  }

  async sendLevel(level, title, lines = []) {
    if (!this.enabled) return;
    const emoji = LEVEL_EMOJI[level] || LEVEL_EMOJI.INFO;
    const body = Array.isArray(lines) ? lines.filter(Boolean).join('\n') : lines;
    await this.send(`${emoji} <b>${title}</b>\n${body}`);
  }

  async notifyBoot({ network, chainId, hasWSS, settings }) {
    await this.sendLevel('INFO', 'SCANNER ONLINE', [
      '━━━━━━━━━━━━━━━━',
      `🌐 Network: ${network} (${chainId})`,
      `🔌 RPC: ${hasWSS ? 'WebSocket ✅ realtime' : 'HTTP fallback ⚠️'}`,
      '',
      '⚙️ <b>Filters:</b>',
      `  • LP Range: ${settings.minLP}-${settings.maxLP} ETH`,
      `  • Tax Limit: ${settings.taxMax} BPS (mode: ${settings.taxMode})`,
      `  • Price Guard: ${settings.priceGuard ? `${settings.priceMultiple}x` : 'Disabled'}`,
      `  • ML Threshold: ${settings.mlThreshold ?? 'N/A'}`,
      `  • Max Consecutive Losses: ${settings.maxConsecutiveLosses}`,
      '',
      '🍌 Banana Gun auto trade đang bật.',
      '',
      `⏰ ${new Date().toLocaleTimeString('vi-VN')}`
    ]);
  }

  async notifyCandidate({
    token,
    pair,
    eth,
    blockNumber,
    txHash,
    creation,
    lpTimestamp,
    metadata,
    dex
  }) {
    const dexscreener = `https://dexscreener.com/${dex?.slug || 'ethereum'}/${pair}`;
    const etherscan = `https://${dex?.explorer || 'etherscan.io'}/address/${token}`;
    const label = metadata?.symbol
      ? `${metadata.symbol} (${metadata.name || 'Token'})`
      : `${token.slice(0, 8)}...${token.slice(-6)}`;

    const creationLine = creation
      ? `🆕 Deploy: <b>#${creation.blockNumber}</b> (${formatDateTime(creation.timestamp)})`
      : '🆕 Deploy: <i>Không xác định</i>';

    const addLpLine = lpTimestamp
      ? `💧 Add LP: <b>#${blockNumber}</b> (${formatDateTime(lpTimestamp)})`
      : `💧 Add LP: <b>#${blockNumber}</b>`;

    await this.sendLevel('INFO', 'TARGET FOUND', [
      '━━━━━━━━━━━━━━━━',
      `🪙 Token: <b>${label}</b>`,
      `📍 Pair: <code>${pair.slice(0, 8)}...${pair.slice(-6)}</code>`,
      `💧 LP: <b>${eth.toFixed(4)} ETH</b>`,
      creationLine,
      addLpLine,
      '',
      `🔗 <a href="${dexscreener}">Dexscreener</a>`,
      `🔗 <a href="${etherscan}">Explorer</a>`,
      txHash ? `🔗 <a href="https://${dex?.explorer || 'etherscan.io'}/tx/${txHash}">AddLP TX</a>` : '',
      '',
      `⏰ ${new Date().toLocaleTimeString('vi-VN')}`
    ]);
  }

  async notifySignal({
    token,
    pair,
    blockNumber,
    lpEth,
    basePriceTokensPerEth,
    taxBps,
    taxDetails,
    priceGuardInfo,
    bananaGun,
    metadata,
    creation,
    dex,
    mlScore,
    honeypot,
    gasRecommendation
  }) {
    const dexscreener = `https://dexscreener.com/${dex?.slug || 'ethereum'}/${pair}`;
    const explorer = `https://${dex?.explorer || 'etherscan.io'}/address/${token}`;
    const bananaGunLink = `https://app.bananagun.io/#/swap?chain=${dex?.chain || 'eth'}&token=${token}`;

    const basePrice = basePriceTokensPerEth > 0n
      ? ethers.formatUnits(basePriceTokensPerEth, 18)
      : 'N/A';

    const taxText = taxBps !== null
      ? `${taxBps} BPS (${(taxBps / 100).toFixed(2)}%)`
      : 'Unknown (allowed by config)';

    let priceGuardText = 'Disabled';
    if (priceGuardInfo) {
      if (priceGuardInfo.status === 'skipped') {
        priceGuardText = 'Skipped (price unavailable)';
      } else if (priceGuardInfo.status === 'ok') {
        priceGuardText = `Change: ${priceGuardInfo.priceChangePercent}%`;
      }
    }

    const autoText = bananaGun
      ? `🤖 <b>Auto Banana Gun:</b> ${bananaGun.amountEth} ETH (slip ${bananaGun.slippageBps} bps, prio ${bananaGun.priorityFeeGwei} gwei, gas x${bananaGun.gasMultiplier})`
      : '👉 <b>Hành động:</b> Mở Banana Gun, dán địa chỉ token và kiểm tra trước khi mua';

    const deployLine = creation ? `🆕 Deploy Block: #${creation.blockNumber}` : '';
    const label = metadata?.symbol
      ? `${metadata.symbol} (${metadata.name || 'Token'})`
      : `${token.slice(0,8)}...${token.slice(-6)}`;

    const mlLine = mlScore ? `🧠 ML Score: <b>${mlScore.score.toFixed(2)}</b> / ${mlScore.threshold} (${mlScore.passed ? 'PASS' : 'FAIL'})` : null;
    const honeypotLine = honeypot?.suspicious ? `🚨 Honeypot risk: ${honeypot.reasons.join(', ')}` : '🛡️ Honeypot check: Clear';

    const gasLine = gasRecommendation ? `⛽ Gas hint: ${gasRecommendation}` : null;

    await this.sendLevel('SUCCESS', 'SIGNAL READY', [
      '━━━━━━━━━━━━━━━━',
      `🪙 Token: <b>${label}</b>`,
      `📍 Pair: <code>${pair.slice(0,8)}...${pair.slice(-6)}</code>`,
      `📦 Block: <b>#${blockNumber}</b>`,
      `💧 LP: <b>${lpEth.toFixed(4)} ETH</b>`,
      `💰 Base Price: ${basePrice} tokens/ETH`,
      `💸 Tax: ${taxText}`,
      `🛡️ Price Guard: ${priceGuardText}`,
      deployLine,
      mlLine,
      honeypotLine,
      gasLine,
      '',
      autoText,
      '',
      `🔗 <a href="${bananaGunLink}">Open in Banana Gun</a>`,
      `🔗 <a href="${dexscreener}">Dexscreener</a>`,
      `🔗 <a href="${explorer}">Explorer</a>`,
      '',
      `📝 ${taxDetails || 'Passed all configured filters'}`,
      `⏰ ${new Date().toLocaleTimeString('vi-VN')}`
    ]);
  }

  async notifySkip({ token, pair, reason, details, blockNumber, lpEth, dex, level = 'WARNING' }) {
    const dexscreener = `https://dexscreener.com/${dex?.slug || 'ethereum'}/${pair}`;
    const label = `${token.slice(0,8)}...${token.slice(-6)}`;

    await this.sendLevel(level, 'SKIPPED', [
      '━━━━━━━━━━━━━━━━',
      `🪙 Token: <code>${label}</code>`,
      `💧 LP: ${lpEth ? `${lpEth.toFixed(4)} ETH` : 'N/A'}`,
      `📦 Block: ${blockNumber ? `#${blockNumber}` : 'N/A'}`,
      '',
      `❌ <b>Lý do:</b> ${reason}`,
      details ? `📝 Chi tiết: ${details}` : '',
      '',
      `🔗 <a href="${dexscreener}">View on Dexscreener</a>`,
      '',
      `⏰ ${new Date().toLocaleTimeString('vi-VN')}`
    ]);
  }

  async notifyBananaGunOrder({ token, pair, amountEth, blockNumber, status, orderId, txHash, response, bananaFee, metadata }) {
    const metadataLines = [];
    if (metadata?.gasCost) metadataLines.push(`⛽ Gas (Banana): ${metadata.gasCost}`);
    if (metadata?.responseId) metadataLines.push(`💬 Telegram msg: <code>${metadata.responseId}</code>`);

    const metadataText = metadataLines.length ? metadataLines.join('\n') : '';

    let responseText = 'No response payload';
    if (response) {
      if (typeof response === 'string') {
        responseText = response;
      } else {
        try {
          responseText = JSON.stringify(response, null, 2);
        } catch (error) {
          responseText = `Không thể hiển thị response: ${error.message}`;
        }
      }
    }

    await this.sendLevel('INFO', 'Banana Gun ORDER SENT', [
      '━━━━━━━━━━━━━━━━',
      `🪙 Token: <code>${token.slice(0,8)}...${token.slice(-6)}</code>`,
      `💰 Amount: ${amountEth} ETH`,
      `📦 Block: #${blockNumber}`,
      `📄 Status: <b>${status}</b>`,
      orderId ? `🆔 Order ID: <code>${orderId}</code>` : '',
      bananaFee ? `🍌 Banana Fee: ${bananaFee}` : '',
      metadataText,
      txHash ? `🔗 <a href="https://etherscan.io/tx/${txHash}">Submitted TX</a>` : '',
      '',
      '📬 Response:',
      `<code>${responseText}</code>`
    ]);
  }

  async notifyBananaGunOrderError({ token, pair, amountEth, blockNumber, error, response }) {
    await this.sendLevel('CRITICAL', 'Banana Gun ORDER FAILED', [
      '━━━━━━━━━━━━━━━━',
      `🪙 Token: <code>${token.slice(0,8)}...${token.slice(-6)}</code>`,
      `💰 Amount: ${amountEth}`,
      `📦 Block: #${blockNumber}`,
      `⚠️ Error: ${error}`,
      response ? `<code>${JSON.stringify(response, null, 2)}</code>` : ''
    ]);
  }

  async notifyBuyFilled({ trade, receipt, bananaFee, pnl }) {
    await this.sendLevel('SUCCESS', 'BUY FILLED', [
      '━━━━━━━━━━━━━━━━',
      `🪙 Token: <code>${trade.token.slice(0,8)}...${trade.token.slice(-6)}</code>`,
      `📦 Block: #${receipt.blockNumber}`,
      `💰 Cost: ${trade.buy.ethSpentEth.toFixed(4)} ETH`,
      `⛽ Gas: ${trade.buy.gasCostEth.toFixed(5)} ETH`,
      bananaFee ? `🍌 Fee: ${bananaFee}` : '',
      pnl ? `📊 Entry Price: ${pnl.entryPrice}` : ''
    ]);
  }

  async notifySellFilled({ trade, summary }) {
    const result = summary.pnlEth >= 0 ? 'SUCCESS' : 'WARNING';
    await this.sendLevel(result === 'SUCCESS' ? 'SUCCESS' : 'WARNING', 'SELL COMPLETED', [
      '━━━━━━━━━━━━━━━━',
      `🪙 Token: <code>${trade.token.slice(0,8)}...${trade.token.slice(-6)}</code>`,
      `📦 Block: #${summary.blockNumber}`,
      `💰 Proceeds: ${summary.proceedsEth.toFixed(4)} ETH`,
      `📊 PnL: ${summary.pnlEth.toFixed(4)} ETH (${summary.pnlPct.toFixed(2)}%)`,
      `⛽ Gas Total: ${summary.totalGasEth.toFixed(5)} ETH`
    ]);
  }

  async notifyTimeoutStopLoss({ token, pair, metadata, pnlPct }) {
    await this.sendLevel('WARNING', 'TIMEOUT SELL TRIGGERED', [
      '━━━━━━━━━━━━━━━━',
      `🪙 Token: <code>${token.slice(0,8)}...${token.slice(-6)}</code>`,
      `📊 PnL: ${pnlPct.toFixed(2)}%`,
      metadata?.symbol ? `📛 Symbol: ${metadata.symbol}` : ''
    ]);
  }

  async notifyRugPull({ token, reason, pnlPct }) {
    await this.sendLevel('CRITICAL', 'RUG DEFENSE SOLD', [
      '━━━━━━━━━━━━━━━━',
      `🪙 Token: <code>${token.slice(0,8)}...${token.slice(-6)}</code>`,
      `⚠️ Reason: ${reason}`,
      `📉 Estimated PnL: ${pnlPct.toFixed(2)}%`
    ]);
  }

  async notifyCircuitBreaker({ consecutiveLosses, cooldownMinutes }) {
    await this.sendLevel('CRITICAL', 'CIRCUIT BREAKER TRIGGERED', [
      '━━━━━━━━━━━━━━━━',
      `📉 Consecutive losses: ${consecutiveLosses}`,
      `⏳ Cooldown: ${cooldownMinutes} phút`
    ]);
  }

  async notifyCircuitReset() {
    await this.sendLevel('SUCCESS', 'CIRCUIT BREAKER RESET', [
      '━━━━━━━━━━━━━━━━',
      '✅ Trading resumed'
    ]);
  }

  async notifyMlReject({ token, score, threshold, breakdown }) {
    await this.notifySkip({
      token,
      pair: token,
      reason: `ML score ${score.toFixed(2)} dưới ngưỡng ${threshold}`,
      details: `Breakdown: ${JSON.stringify(breakdown)}`,
      blockNumber: null,
      lpEth: null,
      dex: null,
      level: 'WARNING'
    });
  }

  async notifyHoneypot({ token, reasons }) {
    await this.notifySkip({
      token,
      pair: token,
      reason: 'Honeypot risk detected',
      details: reasons.join(', '),
      blockNumber: null,
      lpEth: null,
      dex: null,
      level: 'CRITICAL'
    });
  }

  async notifySummary(stats) {
    await this.sendLevel('INFO', 'SESSION SUMMARY', [
      '━━━━━━━━━━━━━━━━',
      `📊 Attempts: ${stats.attempts}`,
      `✅ Wins: ${stats.profitable}`,
      `❌ Losses: ${stats.losing}`,
      `🚫 Aborted: ${stats.aborted}`,
      `💰 Profit: ${stats.totalProfitEth.toFixed(4)} ETH`,
      `💸 Loss: ${stats.totalLossEth.toFixed(4)} ETH`,
      `⛽ Gas: ${stats.totalGasEth.toFixed(4)} ETH`
    ]);
  }

  async notifyShutdown({ reason }) {
    await this.sendLevel('WARNING', 'SCANNER OFFLINE', [
      '━━━━━━━━━━━━━━━━',
      `🛑 Reason: ${reason || 'Unknown'}`,
      `⏱️ ${new Date().toLocaleTimeString('vi-VN')}`
    ]);
  }

  async notifySessionSummary(stats) {
    await this.notifySummary(stats);
  }
}

