export class RiskManager {
  constructor({
    maxConsecutiveLosses = 3,
    cooldownMinutes = 30,
    notifier = null
  } = {}) {
    this.maxConsecutiveLosses = maxConsecutiveLosses;
    this.cooldownMs = Math.max(1, cooldownMinutes) * 60 * 1000;
    this.notifier = notifier;

    this.consecutiveLosses = 0;
    this.circuitOpen = true;
    this.cooldownTimer = null;
  }

  canEnterTrade() {
    return this.circuitOpen;
  }

  recordOutcome(outcome) {
    if (outcome === 'win') {
      this.consecutiveLosses = 0;
    } else if (outcome === 'loss') {
      this.consecutiveLosses += 1;
      if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
        this.tripCircuit();
      }
    }
  }

  tripCircuit() {
    if (!this.circuitOpen) return;
    this.circuitOpen = false;

    if (this.notifier) {
      this.notifier.notifyCircuitBreaker?.({
        consecutiveLosses: this.consecutiveLosses,
        cooldownMinutes: Math.round(this.cooldownMs / 60000)
      });
    }

    clearTimeout(this.cooldownTimer);
    this.cooldownTimer = setTimeout(() => this.resetCircuit(), this.cooldownMs);
  }

  resetCircuit() {
    this.circuitOpen = true;
    this.consecutiveLosses = 0;
    clearTimeout(this.cooldownTimer);
    this.cooldownTimer = null;
    if (this.notifier) {
      this.notifier.notifyCircuitReset?.();
    }
  }

  shutdown() {
    clearTimeout(this.cooldownTimer);
    this.cooldownTimer = null;
  }
}

