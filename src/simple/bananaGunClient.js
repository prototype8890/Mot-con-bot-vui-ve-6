import { ethers } from 'ethers';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function renderTemplate(template, context) {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = context[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function normalizeBotUsername(botUsername) {
  if (!botUsername) return '@BananaGunBot';
  if (botUsername.startsWith('@')) return botUsername;
  return `@${botUsername}`;
}

function parseBananaGunResponse(text) {
  if (!text || typeof text !== 'string') {
    return { txHash: null, bananaFee: null, gasCost: null };
  }

  const txMatch = text.match(/0x[a-fA-F0-9]{64}/);
  const feeMatch = text.match(/banana\s*(?:fee|phí)[:\s]*([\d.,]+)\s*([A-Z]{2,5})?/i);
  const gasMatch = text.match(/gas\s*(?:fee|cost|phí)[:\s]*([\d.,]+)\s*([A-Z]{2,5})?/i);

  const formatAmount = (match) => {
    if (!match) return null;
    const [, amount, unit] = match;
    if (!amount) return null;
    const normalized = amount.replace(',', '.');
    return unit ? `${normalized} ${unit}` : normalized;
  };

  return {
    txHash: txMatch ? txMatch[0] : null,
    bananaFee: formatAmount(feeMatch),
    gasCost: formatAmount(gasMatch)
  };
}

export class BananaGunClient {
  constructor(config) {
    this.enabled = Boolean(config?.enabled);

    if (!this.enabled) {
      return;
    }

    this.apiId = config.apiId;
    this.apiHash = config.apiHash;
    this.session = new StringSession(config.session);
    this.botUsername = normalizeBotUsername(config.botUsername);
    this.buyTemplate = config.buyTemplate;
    this.sellTemplate = config.sellTemplate;
    this.responseTimeoutMs = config.responseTimeoutMs ?? 20000;
    this.amountWei = config.amountWei ?? 0n;
    this.amountEthDisplay = config.amountEthDisplay ?? '0';
    this.slippageBps = config.slippageBps ?? 500;
    this.priorityFeeGwei = config.priorityFeeGwei ?? 3;
    this.gasMultiplier = config.gasMultiplier ?? 1.2;
    this.sellPercent = config.sellPercent ?? 100;
    this.walletAddress = config.walletAddress || null;

    if (!this.apiId || !this.apiHash || !config.session) {
      throw new Error('BananaGunClient thiếu cấu hình Telegram (API ID/hash/session)');
    }

    this.client = new TelegramClient(this.session, this.apiId, this.apiHash, {
      connectionRetries: 5
    });

    this.connected = false;
    this.botEntity = null;
    this.lastInboundId = 0;
  }

  async connect() {
    if (!this.enabled) return;
    if (this.connected) return;

    await this.client.connect();
    this.connected = true;

    await this.#ensureBotEntity();
  }

  async #ensureBotEntity() {
    if (!this.enabled) return null;

    if (!this.botEntity) {
      this.botEntity = await this.client.getEntity(this.botUsername);
    }

    if (this.lastInboundId === 0) {
      const history = await this.client.getMessages(this.botEntity, { limit: 1 });
      if (history?.length) {
        this.lastInboundId = history[0].id;
      }
    }

    return this.botEntity;
  }

  async #awaitResponse(afterId) {
    const timeoutAt = Date.now() + this.responseTimeoutMs;
    let delay = 750;

    while (Date.now() < timeoutAt) {
      const messages = await this.client.getMessages(this.botEntity, { limit: 5 });

      for (const message of messages) {
        if (message.out) continue;
        if (message.id <= afterId) continue;

        this.lastInboundId = Math.max(this.lastInboundId, message.id);
        return message;
      }

      await sleep(delay);
      delay = Math.min(delay + 500, 3000);
    }

    return null;
  }

  #commandContext(overrides = {}) {
    return {
      amount: this.amountEthDisplay,
      amountWei: this.amountWei.toString(),
      slippageBps: this.slippageBps,
      priorityFeeGwei: this.priorityFeeGwei,
      gasMultiplier: this.gasMultiplier,
      percent: this.sellPercent,
      ...overrides
    };
  }

  async submitBuy({ token, pair, blockNumber, lpEth, basePriceTokensPerEth, taxBps, priceGuardInfo, dex }) {
    if (!this.enabled) {
      return { success: false, skipped: true, error: 'Banana Gun client disabled' };
    }

    await this.connect();
    await this.#ensureBotEntity();

    const priceGuardStatus = priceGuardInfo?.status ?? '';
    const priceGuardReason = priceGuardInfo?.reason ?? '';
    const basePrice = basePriceTokensPerEth ? ethers.formatUnits(basePriceTokensPerEth, 18) : '';

    const command = renderTemplate(this.buyTemplate, this.#commandContext({
      token,
      pair,
      blockNumber,
      lpEth,
      taxBps,
      priceGuardStatus,
      priceGuardReason,
      basePriceTokensPerEth: basePrice,
      chain: dex?.chain,
      dex: dex?.name
    }));

    const sent = await this.client.sendMessage(this.botEntity, { message: command });
    const response = await this.#awaitResponse(sent.id);

    const responseText = response?.message || null;
    const parsed = parseBananaGunResponse(responseText);

    return {
      success: true,
      status: response ? 'received' : 'sent',
      command,
      response: responseText,
      txHash: parsed.txHash,
      bananaFee: parsed.bananaFee,
      metadata: {
        gasCost: parsed.gasCost,
        responseId: response?.id ?? null,
        responseDate: response?.date ?? null
      }
    };
  }

  async submitSell({ token, percent, reason, pair, metadata, dex }) {
    if (!this.enabled) {
      return { success: false, skipped: true, error: 'Banana Gun client disabled' };
    }

    await this.connect();
    await this.#ensureBotEntity();

    const context = this.#commandContext({
      token,
      percent: percent ?? this.sellPercent,
      reason,
      pair,
      triggerBlock: metadata?.triggerBlock,
      triggerReason: metadata?.triggerReason,
      chain: dex?.chain,
      dex: dex?.name
    });
    const command = renderTemplate(this.sellTemplate, context);

    const sent = await this.client.sendMessage(this.botEntity, { message: command });
    const response = await this.#awaitResponse(sent.id);

    const responseText = response?.message || null;
    const parsed = parseBananaGunResponse(responseText);

    return {
      success: true,
      status: response ? 'received' : 'sent',
      command,
      response: responseText,
      txHash: parsed.txHash,
      bananaFee: parsed.bananaFee,
      metadata: {
        gasCost: parsed.gasCost,
        responseId: response?.id ?? null,
        responseDate: response?.date ?? null
      }
    };
  }
}
