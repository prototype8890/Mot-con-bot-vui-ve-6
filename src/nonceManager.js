// ✅ FIX: Nonce phải là Number, không phải BigInt
export class NonceManager {
  constructor(startNonce = 0) {
    this.local = Number(startNonce);
  }
  
  set(start) {
    this.local = Number(start);
  }
  
  next() {
    const n = this.local;
    this.local = n + 1;
    return n;
  }
  
  // ✅ Thêm method để sync với chain
  async sync(provider, address) {
    try {
      const chainNonce = await provider.getTransactionCount(address, 'pending');
      if (chainNonce > this.local) {
        this.local = chainNonce;
      }
    } catch (e) {
      console.error('Failed to sync nonce:', e.message);
    }
  }
}