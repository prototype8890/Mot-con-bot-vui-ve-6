import { ethers } from 'ethers';
import { gwei } from './utils.js';

export async function broadcastASAP({ wallet, provider, tx, maxReplacements=5, replaceMs=1500, feeCapGwei=300, prioCapGwei=200 }) {
  const nonce = await provider.getTransactionCount(wallet.address, 'pending');
  let { maxFeePerGas, maxPriorityFeePerGas } = await suggestFees(provider);
  maxFeePerGas = minBig(maxFeePerGas, gwei(feeCapGwei));
  maxPriorityFeePerGas = minBig(maxPriorityFeePerGas, gwei(prioCapGwei));
  for (let i=0;i<maxReplacements;i++){
    const req = { ...tx, nonce, maxFeePerGas, maxPriorityFeePerGas };
    const sent = await wallet.sendTransaction(req);
    try{
      const mined = await provider.waitForTransaction(sent.hash, 0, replaceMs);
      if (mined) return mined;
    }catch{}
    // bump 12.5%
    maxFeePerGas = (maxFeePerGas * 9n) // 1.125 ~ 9/8
      / 8n + 1n;
    maxPriorityFeePerGas = (maxPriorityFeePerGas * 9n) / 8n + 1n;
  }
  throw new Error('TX_NOT_MINED');
}

export async function cancelNonce({ wallet, provider, nonce, baseFee, rivalPrio, addPrioGwei=0.2 }){
  const maxPriorityFeePerGas = rivalPrio ? (rivalPrio + gwei(addPrioGwei)) : gwei(addPrioGwei);
  const maxFeePerGas = (baseFee || (await provider.getBlock('latest')).baseFeePerGas) + maxPriorityFeePerGas;
  const tx = await wallet.sendTransaction({ to: wallet.address, value: 0n, nonce, maxFeePerGas, maxPriorityFeePerGas });
  return tx.wait();
}

async function suggestFees(provider){
  const b = await provider.getBlock('latest');
  const base = b.baseFeePerGas || 0n;
  // priority heuristic: 1.5 gwei
  const prio = 1_500_000_000n;
  return { maxFeePerGas: base + prio, maxPriorityFeePerGas: prio };
}

function minBig(a,b){ return a<b?a:b; }
