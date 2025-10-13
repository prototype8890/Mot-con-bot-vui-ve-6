import { ethers } from 'ethers';

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

  async notifyBoot({ network, chainId, hasWSS, settings }) {
    const msg = `🚀 <b>SCANNER ONLINE</b>
━━━━━━━━━━━━━━━━
🌐 Network: ${network} (${chainId})
🔌 RPC: ${hasWSS ? 'WebSocket ✅ realtime' : 'HTTP fallback ⚠️'}

⚙️ <b>Filters:</b>
  • LP Range: ${settings.minLP}-${settings.maxLP} ETH
  • Tax Limit: ${settings.taxMax} BPS (mode: ${settings.taxMode})
  • Price Guard: ${settings.priceGuard ? `${settings.priceMultiple}x` : 'Disabled'}

🍌 Banana Gun auto trade đang bật.

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  async notifyCandidate({
    token,
    pair,
    eth,
    blockNumber,
    txHash,
    creation,
    lpTimestamp,
    metadata
  }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;
    const etherscan = `https://etherscan.io/address/${token}`;
    const label = metadata?.symbol
      ? `${metadata.symbol} (${metadata.name || 'Token'})`
      : `${token.slice(0, 8)}...${token.slice(-6)}`;

    const creationLine = creation
      ? `🆕 Deploy: <b>#${creation.blockNumber}</b> (${formatDateTime(creation.timestamp)})`
      : '🆕 Deploy: <i>Không xác định</i>';

    const addLpLine = lpTimestamp
      ? `💧 Add LP: <b>#${blockNumber}</b> (${formatDateTime(lpTimestamp)})`
      : `💧 Add LP: <b>#${blockNumber}</b>`;

    const msg = `🔍 <b>TARGET FOUND</b>
━━━━━━━━━━━━━━━━
🪙 Token: <b>${label}</b>
📍 Pair: <code>${pair.slice(0,8)}...${pair.slice(-6)}</code>
💧 LP: <b>${eth.toFixed(4)} ETH</b>
${creationLine}
${addLpLine}

🔗 <a href="${dexscreener}">Dexscreener</a>
🔗 <a href="${etherscan}">Etherscan</a>
${txHash ? `🔗 <a href="https://etherscan.io/tx/${txHash}">AddLP TX</a>` : ''}

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
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
    creation
  }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;
    const etherscan = `https://etherscan.io/address/${token}`;
    const bananaGunLink = `https://app.bananagun.io/#/swap?chain=eth&token=${token}`;

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

    const msg = `🍌 <b>SIGNAL READY</b>
━━━━━━━━━━━━━━━━
🪙 Token: <b>${label}</b>
📍 Pair: <code>${pair.slice(0,8)}...${pair.slice(-6)}</code>
📦 Block: <b>#${blockNumber}</b>
💧 LP: <b>${lpEth.toFixed(4)} ETH</b>
💰 Base Price: ${basePrice} tokens/ETH
💸 Tax: ${taxText}
🛡️ Price Guard: ${priceGuardText}
${deployLine}

${autoText}

🔗 <a href="${bananaGunLink}">Open in Banana Gun</a>
🔗 <a href="${dexscreener}">Dexscreener</a>
🔗 <a href="${etherscan}">Etherscan</a>

📝 ${taxDetails || 'Passed all configured filters'}
⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  async notifySkip({ token, pair, reason, details, blockNumber, lpEth }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;
    const label = `${token.slice(0,8)}...${token.slice(-6)}`;

    const msg = `⏭️ <b>SKIPPED</b>
━━━━━━━━━━━━━━━━
🪙 Token: <code>${label}</code>
💧 LP: ${lpEth ? `${lpEth.toFixed(4)} ETH` : 'N/A'}
📦 Block: ${blockNumber ? `#${blockNumber}` : 'N/A'}

❌ <b>Lý do:</b> ${reason}
${details ? `📝 Chi tiết: ${details}` : ''}

🔗 <a href="${dexscreener}">View on Dexscreener</a>

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  async notifyBananaGunOrder({ token, pair, amountEth, blockNumber, status, orderId, txHash, response, bananaFee, metadata }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;
    const etherscan = `https://etherscan.io/address/${token}`;
    const txLink = txHash ? `🔗 <a href="https://etherscan.io/tx/${txHash}">Submitted TX</a>` : '';

    const metadataLines = [];
    if (metadata?.gasCost) metadataLines.push(`⛽ Gas (Banana): ${metadata.gasCost}`);
    if (metadata?.responseId) metadataLines.push(`💬 Telegram msg: <code>${metadata.responseId}</code>`);

    const metadataText = metadataLines.length ? `\n${metadataLines.join('\n')}` : '';

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

    const msg = `🤖 <b>Banana Gun ORDER SENT</b>
━━━━━━━━━━━━━━━━
🪙 Token: <code>${token.slice(0,8)}...${token.slice(-6)}</code>
💰 Amount: ${amountEth} ETH
📦 Block: #${blockNumber}
📄 Status: <b>${status}</b>
${orderId ? `🆔 Order ID: <code>${orderId}</code>` : ''}
${bananaFee ? `🍌 Banana Fee: ${bananaFee}` : ''}
${metadataText}

🔗 <a href="${dexscreener}">Dexscreener</a>
🔗 <a href="${etherscan}">Token</a>
${txLink}

📝 <b>Banana Gun response:</b>
<pre>${responseText}</pre>

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  async notifyBananaGunOrderError({ token, pair, amountEth, blockNumber, error, response }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;

    let responseText = 'Không có phản hồi (có thể lỗi kết nối)';
    if (response) {
      if (typeof response === 'string') {
        responseText = response;
      } else {
        try {
          responseText = JSON.stringify(response, null, 2);
        } catch (err) {
          responseText = `Không thể hiển thị response: ${err.message}`;
        }
      }
    }

    const msg = `⚠️ <b>Banana Gun ORDER FAILED</b>
━━━━━━━━━━━━━━━━
🪙 Token: <code>${token.slice(0,8)}...${token.slice(-6)}</code>
💰 Amount: ${amountEth} ETH
📦 Block: #${blockNumber}

❗ <b>Error:</b> ${error}
📝 <b>Response:</b>
<pre>${responseText}</pre>

🔗 <a href="${dexscreener}">Dexscreener</a>

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  async notifyBananaGunBuyReport({
    token,
    pair,
    metadata,
    detection,
    buy,
    amountEth,
    priceImpactPct,
    bananaFee
  }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;
    const etherscanTx = buy.txHash ? `https://etherscan.io/tx/${buy.txHash}` : null;
    const label = metadata?.symbol
      ? `${metadata.symbol} (${metadata.name || 'Token'})`
      : `${token.slice(0, 8)}...${token.slice(-6)}`;

    const msg = `✅ <b>Banana Gun BUY EXECUTED</b>
━━━━━━━━━━━━━━━━
🪙 Token: <b>${label}</b>
📍 Pair: <code>${pair.slice(0,8)}...${pair.slice(-6)}</code>
💰 Amount: ${amountEth} ETH

📦 <b>Lifecycle</b>
  • Deploy: ${detection.creation ? `#${detection.creation.blockNumber} (${formatDateTime(detection.creation.timestamp)})` : 'Không rõ'}
  • Add LP: #${detection.blockNumber} (${formatDateTime(detection.lpTimestamp)})
  • Banana Buy: #${buy.blockNumber} (${formatDateTime(buy.timestamp)})

📈 <b>Execution</b>
  • Base Price: ${detection.basePrice}
  • Buy Price: ${buy.price}
  • Impact vs base: ${priceImpactPct >= 0 ? '+' : ''}${priceImpactPct.toFixed(2)}%
  • Tokens: ${buy.tokens}

💸 <b>Costs</b>
  • Gas Used: ${buy.gasUsed.toLocaleString()} @ ${buy.gasPrice} gwei
  • Gas Cost: ${buy.gasCost} ETH
  • Banana Fee: ${bananaFee || 'Unknown'}

🔗 <a href="${dexscreener}">Dexscreener</a>
${etherscanTx ? `🔗 <a href="${etherscanTx}">Buy TX</a>` : ''}

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  async notifyTimeoutStopLoss({ token, pair, metadata, pnlPct }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;
    const label = metadata?.symbol
      ? `${metadata.symbol} (${metadata.name || 'Token'})`
      : `${token.slice(0, 8)}...${token.slice(-6)}`;

    const msg = `⏳ <b>STOP-LOSS (10 phút)</b>
━━━━━━━━━━━━━━━━
🪙 Token: <b>${label}</b>
📉 Hiện tại: ${pnlPct.toFixed(2)}%
⚠️ Sau 10 phút chưa đạt giá mong muốn → gửi lệnh bán toàn bộ.

🔗 <a href="${dexscreener}">Dexscreener</a>

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  async notifyAutoSellReport({
    token,
    pair,
    metadata,
    reason,
    detection,
    buy,
    sell,
    pnlPct,
    pnlEth,
    bananaFee
  }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;
    const etherscanTx = sell.txHash ? `https://etherscan.io/tx/${sell.txHash}` : null;
    const label = metadata?.symbol
      ? `${metadata.symbol} (${metadata.name || 'Token'})`
      : `${token.slice(0, 8)}...${token.slice(-6)}`;
    const pnlEmoji = pnlPct >= 0 ? '💰' : '📉';
    const pnlSign = pnlPct >= 0 ? '+' : '';
    const pnlEthSign = pnlEth >= 0 ? '+' : '';

    const msg = `${pnlEmoji} <b>BANANA SELL EXECUTED</b>
━━━━━━━━━━━━━━━━
🪙 Token: <b>${label}</b>
📊 Reason: ${reason}
💰 ETH nhận: ${sell.ethReceived} ETH
💹 P&L: ${pnlSign}${pnlPct.toFixed(2)}% (${pnlEthSign}${pnlEth.toFixed(4)} ETH)
🍌 Banana Fee: ${bananaFee || 'Unknown'}

📦 <b>Lifecycle</b>
  • Add LP: #${detection.blockNumber}
  • Buy: #${buy.blockNumber}
  • Sell: #${sell.blockNumber}
  • Giữ: ${formatHoldTime(Math.max(0, sell.timestamp - buy.timestamp))}

💸 <b>Gas</b>
  • Gas Used: ${sell.gasUsed.toLocaleString()} @ ${sell.gasPrice} gwei
  • Gas Cost: ${sell.gasCost} ETH

🔗 <a href="${dexscreener}">Dexscreener</a>
${etherscanTx ? `🔗 <a href="${etherscanTx}">Sell TX</a>` : ''}

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  async notifyRugAlert({ token, pair, kind, rugTxHash, blockNumber, metadata }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;
    const rugTx = `https://etherscan.io/tx/${rugTxHash}`;
    const label = metadata?.symbol
      ? `${metadata.symbol} (${metadata.name || 'Token'})`
      : `${token.slice(0,10)}...`;

    const msg = `🚨 <b>RUG PULL DETECTED</b>
━━━━━━━━━━━━━━━━
🪙 Token: <b>${label}</b>
⚠️ Type: <b>${kind}</b>
📦 Block: #${blockNumber}

🔗 <a href="${rugTx}">Rug Transaction</a>
🔗 <a href="${dexscreener}">Dexscreener</a>

⚡ <b>Đang gửi lệnh bán để front-run...</b>`;

    await this.send(msg);
  }

  async notifyRugFrontRunResult({ token, pair, sell }) {
    const dexscreener = `https://dexscreener.com/ethereum/${pair}`;
    const etherscanTx = sell.txHash ? `https://etherscan.io/tx/${sell.txHash}` : null;

    const msg = `⚡ <b>RUG FRONT-RUN COMPLETED</b>
━━━━━━━━━━━━━━━━
🪙 Token: <code>${token.slice(0,8)}...${token.slice(-6)}</code>
📦 Block: #${sell.blockNumber}
💰 ETH nhận: ${sell.ethReceived} ETH

🔗 <a href="${dexscreener}">Dexscreener</a>
${etherscanTx ? `🔗 <a href="${etherscanTx}">Sell TX</a>` : ''}

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  async notifyShutdown({ reason }) {
    const msg = `🛑 <b>SCANNER STOPPING</b>
━━━━━━━━━━━━━━━━
📝 Reason: ${reason || 'N/A'}

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }

  async notifySessionSummary({
    totalTrades,
    successful,
    failed,
    totalProfitEth,
    totalLossEth,
    netProfitEth,
    winRate,
    bananaFees,
    gasEth
  }) {
    const netSign = netProfitEth >= 0 ? '+' : '';
    const msg = `📦 <b>SESSION SUMMARY</b>
━━━━━━━━━━━━━━━━
📈 Trades: ${totalTrades} (✅ ${successful} / ❌ ${failed})
🏆 Win rate: ${winRate.toFixed(2)}%

💰 Profit: +${totalProfitEth.toFixed(4)} ETH
📉 Loss: -${totalLossEth.toFixed(4)} ETH
💸 Gas: ${gasEth.toFixed(4)} ETH
🍌 Banana Fees: ${bananaFees.length ? bananaFees.join(', ') : 'Unknown'}
📊 Net: ${netSign}${netProfitEth.toFixed(4)} ETH

⏰ ${new Date().toLocaleTimeString('vi-VN')}`;

    await this.send(msg);
  }
}

export function formatHoldTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function calculateGasCost(gasUsed, effectiveGasPrice) {
  const gasCostWei = BigInt(gasUsed) * BigInt(effectiveGasPrice);
  return ethers.formatEther(gasCostWei);
}

export function formatDateTime(timestamp) {
  if (!timestamp) return 'N/A';
  const date = new Date(Number(timestamp) * 1000);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString('vi-VN');
}
