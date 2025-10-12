export class CircuitBreaker {
  constructor({ maxFailRate, windowSec, maxRpcErrors, maxBlockDelayMs }, notifier=null) {
    this.maxFailRate = maxFailRate;
    this.windowSec = windowSec;
    this.maxRpcErrors = maxRpcErrors;
    this.maxBlockDelayMs = maxBlockDelayMs;
    this.notifier = notifier;
    this.events = [];
    this.rpcErrors = 0;
  }
  record(ok) {
    const now = Math.floor(Date.now()/1000);
    this.events.push({ ok, t: now });
    this.events = this.events.filter(e => now - e.t <= this.windowSec);
  }
  recordRpcError() { this.rpcErrors++; }
  resetRpcErrors() { this.rpcErrors = 0; }
  async check(blockTsMs) {
    const nowMs = Date.now();
    const failRate = this.events.length ? (this.events.filter(e=>!e.ok).length / this.events.length) : 0;
    if (failRate >= this.maxFailRate) { await this.notify('Circuit tripped: fail rate'); throw new Error('CircuitBreaker: fail rate'); }
    if (this.rpcErrors >= this.maxRpcErrors) { await this.notify('Circuit tripped: RPC errors'); throw new Error('CircuitBreaker: rpc errors'); }
    if (blockTsMs && nowMs - blockTsMs > this.maxBlockDelayMs) { await this.notify('Circuit tripped: block delay'); throw new Error('CircuitBreaker: block delay'); }
  }
  async notify(msg) { if (this.notifier) await this.notifier.send(msg); }
}
