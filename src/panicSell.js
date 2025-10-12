import { ethers } from 'ethers';
import { IERC20, IUniswapV2Router } from './abi.js'; // ✅ FIX: Đổi ERC20 thành IERC20
import { gwei } from './utils.js';

export function makePanicSell({ provider, wallet, routerAddr, tokenAddr, wethAddr, addPrioGwei=0.2, deadlineSec=60 }){
  const erc20 = new ethers.Contract(tokenAddr, IERC20, provider).connect(wallet); // ✅ FIX
  const routerIface = new ethers.Interface(IUniswapV2Router);
  const path = [tokenAddr, wethAddr];

  async function ensureApprove(){
    try {
      const allowance = await erc20.allowance(wallet.address, routerAddr);
      if (allowance > 0n) return true;
      
      const tx = await erc20.approve(routerAddr, ethers.MaxUint256); // ✅ FIX: Dùng MaxUint256
      await tx.wait();
      return true;
    } catch (e) {
      console.error('Approve failed:', e.message);
      return false;
    }
  }

  async function sellAll({ rivalTip }){
    try {
      const bal = await erc20.balanceOf(wallet.address);
      if (bal === 0n) return { sold:false, txHash:null, reason: 'zero-balance' };

      // ✅ FIX: Kiểm tra approve thành công
      const approved = await ensureApprove();
      if (!approved) return { sold:false, txHash:null, reason: 'approve-failed' };

      const deadline = Math.floor(Date.now()/1000) + deadlineSec;
      const b = await provider.getBlock('latest');
      const maxPriorityFeePerGas = (rivalTip && rivalTip>0n) ? (rivalTip + gwei(addPrioGwei)) : gwei(addPrioGwei);
      const maxFeePerGas = (b.baseFeePerGas||0n) + maxPriorityFeePerGas;

      const data = routerIface.encodeFunctionData('swapExactTokensForETHSupportingFeeOnTransferTokens',
        [ bal, 0n, path, wallet.address, deadline ]);

      const tx = await wallet.sendTransaction({ 
        to: routerAddr, 
        data, 
        maxFeePerGas, 
        maxPriorityFeePerGas,
        gasLimit: 300000n // ✅ FIX: Thêm gas limit
      });
      
      const rcpt = await tx.wait();
      return { sold:true, txHash: rcpt.hash };
    } catch (e) {
      console.error('Sell failed:', e.message);
      return { sold:false, txHash:null, reason: e.message };
    }
  }

  return { sellAll };
}