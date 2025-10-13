import { ethers } from 'ethers';

export class GasOptimizer {
  constructor({ cacheMs = 5000, multiplier = 1, priorityFeeOverrideGwei = null } = {}) {
    this.cacheMs = cacheMs;
    this.multiplier = multiplier;
    this.priorityFeeOverrideGwei = priorityFeeOverrideGwei;
    this.lastUpdate = 0;
    this.cachedFees = null;
  }

  async getFeeData(provider) {
    const now = Date.now();
    if (this.cachedFees && now - this.lastUpdate < this.cacheMs) {
      return this.cachedFees;
    }

    const feeData = await provider.getFeeData();
    const baseFee = feeData.maxFeePerGas || feeData.gasPrice || 0n;
    const priorityFee = this.priorityFeeOverrideGwei !== null
      ? ethers.parseUnits(String(this.priorityFeeOverrideGwei), 'gwei')
      : feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei');

    const maxFee = BigInt(Math.floor(Number(baseFee) * this.multiplier)) + priorityFee;

    this.cachedFees = {
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: priorityFee,
      gasPrice: feeData.gasPrice || maxFee
    };
    this.lastUpdate = now;
    return this.cachedFees;
  }
}

