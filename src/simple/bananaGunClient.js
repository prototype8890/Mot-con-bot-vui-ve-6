import { ethers } from 'ethers';

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function extractFeeFromResponse(response) {
  if (!response || typeof response !== 'object') return null;

  const feeFields = [
    'bananaFee',
    'serviceFee',
    'fee',
    'banana_fee',
    'fees'
  ];

  for (const field of feeFields) {
    const value = response[field];
    if (!value) continue;

    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);

    if (typeof value === 'object') {
      if (value.eth) return String(value.eth);
      if (value.banana) return String(value.banana);
      if (value.amount) return String(value.amount);
    }
  }

  if (response.metadata && typeof response.metadata === 'object') {
    return extractFeeFromResponse(response.metadata);
  }

  return null;
}

export class BananaGunClient {
  constructor(config) {
    this.enabled = Boolean(config?.enabled);
    this.apiUrl = config?.apiUrl?.trim();
    this.apiKey = config?.apiKey?.trim();
    this.walletId = config?.walletId?.trim();
    this.amountWei = config?.amountWei ?? 0n;
    this.slippageBps = config?.slippageBps ?? 500;
    this.priorityFeeGwei = config?.priorityFeeGwei ?? 3;
    this.gasMultiplier = config?.gasMultiplier ?? 1.2;
    this.autoApprove = Boolean(config?.autoApprove ?? true);
    this.sourceTag = config?.sourceTag || 'mempool_scanner';
    this.extraHeaders = config?.extraHeaders || {};
    this.sellPercent = config?.sellPercent ?? 100;
    this.sellUrl = config?.sellUrl?.trim() || this.apiUrl;

    if (this.enabled) {
      if (!this.apiUrl) throw new Error('BananaGunClient enabled without apiUrl');
      if (!this.apiKey) throw new Error('BananaGunClient enabled without apiKey');
      if (!this.walletId) throw new Error('BananaGunClient enabled without walletId');
      if (this.amountWei <= 0n) throw new Error('BananaGunClient amount must be > 0');
    }
  }

  get amountEth() {
    return Number(ethers.formatEther(this.amountWei));
  }

  get defaultSellPercent() {
    return Math.min(Math.max(this.sellPercent, 1), 100);
  }

  async submitBuy({ token, pair, blockNumber, lpEth, basePriceTokensPerEth, taxBps, priceGuardInfo }) {
    if (!this.enabled) {
      return { success: false, skipped: true, error: 'Banana Gun client disabled' };
    }

    const payload = {
      chain: 'eth',
      walletId: this.walletId,
      tokenAddress: token,
      amountEth: ethers.formatEther(this.amountWei),
      slippageBps: this.slippageBps,
      priorityFeeGwei: this.priorityFeeGwei,
      gasMultiplier: this.gasMultiplier,
      autoApprove: this.autoApprove,
      source: this.sourceTag,
      intent: 'buy',
      metadata: {
        pair,
        blockNumber,
        lpEth,
        basePriceTokensPerEth: basePriceTokensPerEth ? ethers.formatUnits(basePriceTokensPerEth, 18) : null,
        taxBps,
        priceGuardInfo
      }
    };

    return this.#post({ url: this.apiUrl, payload });
  }

  async submitSell({ token, pair, reason, percent, metadata }) {
    if (!this.enabled) {
      return { success: false, skipped: true, error: 'Banana Gun client disabled' };
    }

    const payload = {
      chain: 'eth',
      walletId: this.walletId,
      tokenAddress: token,
      percent: percent ?? this.defaultSellPercent,
      intent: 'sell',
      source: this.sourceTag,
      metadata: {
        pair,
        reason,
        ...(metadata || {})
      }
    };

    return this.#post({ url: this.sellUrl || this.apiUrl, payload });
  }

  async #post({ url, payload }) {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      ...this.extraHeaders
    };

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
    } catch (networkError) {
      return {
        success: false,
        error: `Network error: ${networkError.message}`,
        payload
      };
    }

    const text = await response.text();
    const json = safeParseJson(text);

    if (!response.ok) {
      const message = json?.message || json?.error || text || `HTTP ${response.status}`;
      return {
        success: false,
        status: response.status,
        error: message,
        payload,
        response: json || text
      };
    }

    const bananaFee = extractFeeFromResponse(json);

    return {
      success: true,
      status: json?.status || 'submitted',
      orderId: json?.orderId || json?.id || null,
      txHash: json?.txHash || json?.transactionHash || null,
      payload,
      response: json || text,
      bananaFee
    };
  }
}
