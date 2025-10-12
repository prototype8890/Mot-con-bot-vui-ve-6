
import { ethers } from 'ethers';
export function subscribeBlocks(provider, onBlock) {
  provider.on('block', async (bn) => {
    const b = await provider.getBlock(bn);
    await onBlock(b);
  });
}
