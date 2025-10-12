import { ethers } from 'ethers';
import { ERC20, IUniswapV2Router } from './abi.js';
import { gwei } from './utils.js';

export function makePanicSell({ provider, wallet, routerAddr, tokenAddr, wethAddr, addPrioGwei=0.2, deadlineSec=60 }){
  const erc20 = new ethers.Contract(tokenAddr, ERC20, provider).connect(wallet);
  const routerIface = new ethers.Interface(IUniswapV2Router);
  const path = [tokenAddr, wethAddr];

  async function ensureApprove(){
    const allowance = await erc20.allowance(wallet.address, routerAddr);
    if (allowance > 0n) return;
    const tx = await erc20.approve(routerAddr, 2n**256n-1n);
    await tx.wait();
  }

  async function sellAll({ rivalTip }){
    const bal = await erc20.balanceOf(wallet.address);
    if (bal === 0n) return { sold:false, txHash:null };

    await ensureApprove();
    const deadline = Math.floor(Date.now()/1000) + deadlineSec;
    const b = await provider.getBlock('latest');
    const maxPriorityFeePerGas = (rivalTip && rivalTip>0n) ? (rivalTip + gwei(addPrioGwei)) : gwei(addPrioGwei);
    const maxFeePerGas = (b.baseFeePerGas||0n) + maxPriorityFeePerGas;

    const data = routerIface.encodeFunctionData('swapExactTokensForETHSupportingFeeOnTransferTokens',
      [ bal, 0n, path, wallet.address, deadline ]);

    const tx = await wallet.sendTransaction({ to: routerAddr, data, maxFeePerGas, maxPriorityFeePerGas });
    const rcpt = await tx.wait();
    return { sold:true, txHash: rcpt.hash };
  }

  return { sellAll };
}
