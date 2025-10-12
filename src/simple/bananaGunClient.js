import { ethers } from 'ethers';

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
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
      metadata: {
        pair,
        blockNumber,
        lpEth,
        basePriceTokensPerEth: basePriceTokensPerEth ? ethers.formatUnits(basePriceTokensPerEth, 18) : null,
        taxBps,
        priceGuardInfo
      }
    };

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      ...this.extraHeaders
    };

    let response;
    try {
      response = await fetch(this.apiUrl, {
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

    return {
      success: true,
      status: json?.status || 'submitted',
      orderId: json?.orderId || json?.id || null,
      txHash: json?.txHash || null,
      payload,
      response: json || text
    };
  }
}
