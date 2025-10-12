// sell.js - Enhanced sell với panic mode
import { ethers } from 'ethers';
import { IUniswapV2Router, IERC20 } from './abi.js';

/**
 * 🔥 Enhanced sellAll với panic mode support
 */
export async function sellAll({ 
  router, 
  token, 
  weth, 
  wallet,
  isPanic = false // 🔥 New: panic mode flag
}) {
  try {
    const tokenContract = new ethers.Contract(token, IERC20, wallet);
    const balance = await tokenContract.balanceOf(wallet.address);
    
    if (balance === 0n) {
      return { sold: false, reason: 'Zero balance', hash: null };
    }
    
    console.log(`[sell] Token balance: ${ethers.formatUnits(balance, 18)}`);
    
    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Approve if needed
    // ═══════════════════════════════════════════════════════════════
    
    const allowance = await tokenContract.allowance(wallet.address, router);
    
    if (allowance < balance) {
      console.log('[sell] Approving tokens...');
      const approveTx = await tokenContract.approve(router, ethers.MaxUint256);
      await approveTx.wait(1);
      console.log('[sell] ✅ Approval confirmed');
    }
    
    // ═══════════════════════════════════════════════════════════════
    // STEP 2: Get gas settings based on mode
    // ═══════════════════════════════════════════════════════════════
    
    let maxPriorityFeeGwei, maxFeeGwei, slippageBps, deadline;
    
    if (isPanic) {
      // 🚨 PANIC MODE - Aggressive settings
      const panicTipAdd = Number(process.env.PANIC_TIP_ADD_GWEI || '10');
      maxPriorityFeeGwei = Number(process.env.PANIC_MAX_PRIORITY_FEE_GWEI || '150');
      maxFeeGwei = Number(process.env.PANIC_MAX_FEE_GWEI || '400');
      slippageBps = Number(process.env.PANIC_SLIPPAGE_BPS || '5000'); // 50%
      
      const deadlineSec = Number(process.env.PANIC_DEADLINE_SEC || '60');
      deadline = Math.floor(Date.now() / 1000) + deadlineSec;
      
      console.log(`[sell] 🚨 PANIC MODE ACTIVE`);
      console.log(`[sell] Gas: maxPriority=${maxPriorityFeeGwei}Gwei, maxFee=${maxFeeGwei}Gwei`);
      console.log(`[sell] Slippage: ${slippageBps/100}%, Deadline: ${deadlineSec}s`);
      
    } else {
      // 📊 NORMAL MODE
      maxPriorityFeeGwei = Number(process.env.MAX_PRIORITY_FEE_GWEI || '5');
      maxFeeGwei = Number(process.env.MAX_FEE_GWEI || '150');
      slippageBps = Number(process.env.SLIPPAGE_BPS || '1500'); // 15%
      deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes
      
      console.log(`[sell] 📊 Normal sell mode`);
      console.log(`[sell] Gas: maxPriority=${maxPriorityFeeGwei}Gwei, maxFee=${maxFeeGwei}Gwei`);
    }
    
    // ═══════════════════════════════════════════════════════════════
    // STEP 3: Calculate amountOutMin with slippage
    // ═══════════════════════════════════════════════════════════════
    
    const routerContract = new ethers.Contract(router, IUniswapV2Router, wallet);
    let amountOutMin = 0n;
    
    try {
      const amounts = await routerContract.getAmountsOut(balance, [token, weth]);
      const expectedEth = amounts[1];
      amountOutMin = (expectedEth * BigInt(10000 - slippageBps)) / 10000n;
      
      console.log(`[sell] Expected ETH: ${ethers.formatEther(expectedEth)}`);
      console.log(`[sell] Min ETH (${slippageBps/100}% slippage): ${ethers.formatEther(amountOutMin)}`);
    } catch (error) {
      console.log(`[sell] ⚠️  Cannot estimate output, using amountOutMin=0`);
      amountOutMin = 0n;
    }
    
    // ═══════════════════════════════════════════════════════════════
    // STEP 4: Get current gas price and boost if needed
    // ═══════════════════════════════════════════════════════════════
    
    const feeData = await wallet.provider.getFeeData();
    
    let maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || 
                               ethers.parseUnits(String(maxPriorityFeeGwei), 'gwei');
    let maxFeePerGas = feeData.maxFeePerGas || 
                       ethers.parseUnits(String(maxFeeGwei), 'gwei');
    
    if (isPanic) {
      // 🚨 Boost gas significantly for panic
      maxPriorityFeePerGas = maxPriorityFeePerGas * 200n / 100n; // 2x boost
      maxFeePerGas = maxFeePerGas * 150n / 100n; // 1.5x boost
      
      // Apply caps
      const capPriority = ethers.parseUnits(String(maxPriorityFeeGwei), 'gwei');
      const capFee = ethers.parseUnits(String(maxFeeGwei), 'gwei');
      
      if (maxPriorityFeePerGas > capPriority) maxPriorityFeePerGas = capPriority;
      if (maxFeePerGas > capFee) maxFeePerGas = capFee;
    }
    
    // Ensure maxFeePerGas > maxPriorityFeePerGas
    if (maxFeePerGas < maxPriorityFeePerGas) {
      maxFeePerGas = maxPriorityFeePerGas * 2n;
    }
    
    console.log(`[sell] Final gas: priority=${ethers.formatUnits(maxPriorityFeePerGas, 'gwei')}Gwei, max=${ethers.formatUnits(maxFeePerGas, 'gwei')}Gwei`);
    
    // ═══════════════════════════════════════════════════════════════
    // STEP 5: Estimate gas limit
    // ═══════════════════════════════════════════════════════════════
    
    let gasLimit = 200000n; // Default
    
    try {
      const estimated = await routerContract.swapExactTokensForETHSupportingFeeOnTransferTokens.estimateGas(
        balance,
        amountOutMin,
        [token, weth],
        wallet.address,
        deadline
      );
      
      const gasMultiplier = Number(process.env.GAS_MULTIPLIER || '1.3');
      gasLimit = (estimated * BigInt(Math.floor(gasMultiplier * 100))) / 100n;
      
      console.log(`[sell] Gas estimated: ${estimated} → using ${gasLimit}`);
    } catch (error) {
      console.log(`[sell] Gas estimation failed, using default: ${gasLimit}`);
    }
    
    // ═══════════════════════════════════════════════════════════════
    // STEP 6: Execute sell
    // ═══════════════════════════════════════════════════════════════
    
    console.log(`[sell] 🎯 Executing sell...`);
    
    let tx;
    try {
      tx = await routerContract.swapExactTokensForETHSupportingFeeOnTransferTokens(
        balance,
        amountOutMin,
        [token, weth],
        wallet.address,
        deadline,
        {
          gasLimit,
          maxPriorityFeePerGas,
          maxFeePerGas
        }
      );
    } catch (fotError) {
      console.log(`[sell] FOT sell failed, trying standard...`);
      
      tx = await routerContract.swapExactTokensForETH(
        balance,
        amountOutMin,
        [token, weth],
        wallet.address,
        deadline,
        {
          gasLimit,
          maxPriorityFeePerGas,
          maxFeePerGas
        }
      );
    }
    
    console.log(`[sell] ✅ Transaction sent: ${tx.hash}`);
    
    return { 
      sold: true, 
      hash: tx.hash,
      isPanic
    };
    
  } catch (error) {
    console.error(`[sell] ❌ Error:`, error.message);
    return { 
      sold: false, 
      reason: error.message,
      hash: null 
    };
  }
}

/**
 * Helper: Quick estimate sell value
 */
export async function estimateSellValue({ provider, router, token, weth, amount }) {
  try {
    const routerContract = new ethers.Contract(router, IUniswapV2Router, provider);
    const amounts = await routerContract.getAmountsOut(amount, [token, weth]);
    return amounts[1]; // ETH amount
  } catch {
    return 0n;
  }
}