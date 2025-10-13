// buy.js - Enhanced buy function với better error handling
import { ethers } from 'ethers';
import { IUniswapV2Router } from './abi.js';

/**
 * 🔥 Enhanced buyExactETH với multiple improvements
 */
function extractErrorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;

  const nested = error.error?.message || error.info?.error?.message;
  if (nested) return nested;

  if (error.shortMessage) return error.shortMessage;
  if (error.reason) return error.reason;

  return error.message || String(error);
}

export async function buyExactETH({
  router,
  weth,
  token,
  wallet,
  amountWei,
  slippageBps = null, // Will use from env
  gasMultiplier = null,  // Will use from env
  maxPriorityFeeGwei = null, // Will use from env
  maxFeeGwei = null // Will use from env
}) {
  // 🔥 Read from env if not provided
  slippageBps = slippageBps ?? Number(process.env.SLIPPAGE_BPS || '1500');
  gasMultiplier = gasMultiplier ?? Number(process.env.GAS_MULTIPLIER || '1.3');
  maxPriorityFeeGwei = maxPriorityFeeGwei ?? Number(process.env.MAX_PRIORITY_FEE_GWEI || '5');
  maxFeeGwei = maxFeeGwei ?? Number(process.env.MAX_FEE_GWEI || '150');
  
  console.log(`[buy] Using settings: slippage=${slippageBps/100}%, gasMultiplier=${gasMultiplier}, maxPriorityFee=${maxPriorityFeeGwei}Gwei, maxFee=${maxFeeGwei}Gwei`);
  const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes
  const routerContract = new ethers.Contract(router, IUniswapV2Router, wallet);
  
  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Calculate minimum tokens with slippage
  // ═══════════════════════════════════════════════════════════════
  
  let amountOutMin = 0n;
  try {
    const amounts = await routerContract.getAmountsOut(amountWei, [weth, token]);
    const expectedOut = amounts[1];
    
    // Apply slippage: amountOutMin = expectedOut * (10000 - slippageBps) / 10000
    amountOutMin = (expectedOut * BigInt(10000 - slippageBps)) / 10000n;
    
    console.log(`[buy] Expected tokens: ${ethers.formatUnits(expectedOut, 18)}`);
    console.log(`[buy] Min tokens (with ${slippageBps/100}% slippage): ${ethers.formatUnits(amountOutMin, 18)}`);
  } catch (error) {
    console.log(`[buy] ⚠️  Cannot estimate output, using amountOutMin=0 (risky)`);
    amountOutMin = 0n; // Fallback to 0 (accept any amount)
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Estimate gas
  // ═══════════════════════════════════════════════════════════════
  
  let estimatedGas = 250000n; // Default fallback
  
  try {
    // Try estimate with supporting fee-on-transfer first
    const estimated = await routerContract.swapExactETHForTokensSupportingFeeOnTransferTokens.estimateGas(
      amountOutMin,
      [weth, token],
      wallet.address,
      deadline,
      { value: amountWei }
    );
    
    estimatedGas = (estimated * BigInt(Math.floor(gasMultiplier * 100))) / 100n;
    console.log(`[buy] Gas estimated: ${estimated.toString()} → using ${estimatedGas.toString()} (${gasMultiplier}x)`);
    
  } catch (error) {
    // 🔥 FIX: If estimation fails, try to understand WHY
    console.log(`[buy] ⚠️  Gas estimation failed: ${error.message}`);
    
    // Common revert reasons
    if (error.message.includes('TRANSFER_FROM_FAILED') || 
        error.message.includes('TransferHelper')) {
      throw new Error('Trading not enabled yet - wait for liquidity to be added');
    }
    
    if (error.message.includes('INSUFFICIENT_OUTPUT_AMOUNT')) {
      throw new Error(`Slippage too high - price moved > ${slippageBps/100}%`);
    }
    
    if (error.message.includes('EXCESSIVE_INPUT_AMOUNT')) {
      throw new Error('Amount too large - exceeds max transaction limit');
    }
    
    if (error.message.includes('Blacklist') || 
        error.message.includes('blacklist')) {
      throw new Error('Wallet blacklisted by token contract');
    }
    
    // Try without fee-on-transfer
    try {
      const estimated2 = await routerContract.swapExactETHForTokens.estimateGas(
        amountOutMin,
        [weth, token],
        wallet.address,
        deadline,
        { value: amountWei }
      );
      
      estimatedGas = (estimated2 * BigInt(Math.floor(gasMultiplier * 100))) / 100n;
      console.log(`[buy] Gas estimated (non-FOT): ${estimatedGas.toString()}`);
      
    } catch (error2) {
      console.log(`[buy] ⚠️  Both gas estimation methods failed, using fallback: ${estimatedGas}`);
      // Use fallback gas but continue
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STEP 3: Get current gas price
  // ═══════════════════════════════════════════════════════════════
  
  const feeData = await wallet.provider.getFeeData();
  
  let maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits(String(maxPriorityFeeGwei), 'gwei');
  let maxFeePerGas = feeData.maxFeePerGas || ethers.parseUnits(String(maxFeeGwei), 'gwei');
  
  // 🔥 FIX: Boost priority fee để compete với MEV bots
  maxPriorityFeePerGas = maxPriorityFeePerGas * 150n / 100n; // +50%
  
  // Ensure maxFeePerGas > maxPriorityFeePerGas
  if (maxFeePerGas < maxPriorityFeePerGas) {
    maxFeePerGas = maxPriorityFeePerGas * 2n;
  }
  
  console.log(`[buy] Gas settings:`);
  console.log(`  - Max priority fee: ${ethers.formatUnits(maxPriorityFeePerGas, 'gwei')} Gwei`);
  console.log(`  - Max fee: ${ethers.formatUnits(maxFeePerGas, 'gwei')} Gwei`);
  console.log(`  - Gas limit: ${estimatedGas.toString()}`);
  
  // ═══════════════════════════════════════════════════════════════
  // STEP 4: Execute transaction with retry logic
  // ═══════════════════════════════════════════════════════════════
  
  const maxRetries = Number(process.env.BUY_MAX_RETRIES || '3');
  let lastError = null;
  let lastErrorMsg = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[buy] 🎯 Attempt ${attempt}/${maxRetries} - Sending transaction...`);
      
      // Try with fee-on-transfer support first
      let tx;
      try {
        tx = await routerContract.swapExactETHForTokensSupportingFeeOnTransferTokens(
          amountOutMin,
          [weth, token],
          wallet.address,
          deadline,
          {
            value: amountWei,
            gasLimit: estimatedGas,
            maxPriorityFeePerGas,
            maxFeePerGas
          }
        );
      } catch (feeError) {
        console.log(`[buy] FOT swap failed, trying standard swap...`);
        
        // Fallback to standard swap
        tx = await routerContract.swapExactETHForTokens(
          amountOutMin,
          [weth, token],
          wallet.address,
          deadline,
          {
            value: amountWei,
            gasLimit: estimatedGas,
            maxPriorityFeePerGas,
            maxFeePerGas
          }
        );
      }
      
      console.log(`[buy] ✅ Transaction sent: ${tx.hash}`);
      return tx; // Success!
      
    } catch (error) {
      lastError = error;
      lastErrorMsg = extractErrorMessage(error);
      console.log(`[buy] ❌ Attempt ${attempt} failed: ${lastErrorMsg}`);

      // Parse error
      const lowered = lastErrorMsg.toLowerCase();

      if (lowered.includes('insufficient funds')) {
        throw new Error('Insufficient ETH balance for transaction + gas');
      }

      if (lowered.includes('nonce')) {
        console.log(`[buy] Nonce issue, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      if (lowered.includes('replacement fee too low')) {
        console.log(`[buy] Increasing gas price...`);
        maxPriorityFeePerGas = maxPriorityFeePerGas * 110n / 100n; // +10%
        maxFeePerGas = maxFeePerGas * 110n / 100n;
        continue;
      }

      // If this is not the last attempt, wait and retry
      if (attempt < maxRetries) {
        console.log(`[buy] Waiting 2s before retry...`);
        await new Promise(resolve => setTimeout(resolve, 2000));

        const priceRevert = lowered.includes('insufficient_output_amount') ||
                             lowered.includes('insufficient_input_amount');

        if (priceRevert && attempt === maxRetries - 1) {
          console.log('[buy] ⚠️  Final retry will accept any output (amountOutMin=0)');
          amountOutMin = 0n;
        } else {
          // Increase slippage for retry (more aggressive if price moved)
          const bump = priceRevert ? 1500 : 500; // +15% if price moved hard
          slippageBps = Math.min(slippageBps + bump, 9500); // Cap at 95%
          console.log(`[buy] Increasing slippage to ${slippageBps/100}% for retry`);

          // Recalculate amountOutMin
          try {
            const amounts = await routerContract.getAmountsOut(amountWei, [weth, token]);
            amountOutMin = (amounts[1] * BigInt(10000 - slippageBps)) / 10000n;
          } catch (quoteError) {
            console.log(`[buy] ⚠️  Quote failed on retry: ${extractErrorMessage(quoteError)}`);
            if (priceRevert) {
              console.log('[buy] ➜ Fallback to amountOutMin=0 for next attempt');
              amountOutMin = 0n;
            }
          }
        }

        continue;
      }
    }
  }

  // All retries failed
  throw new Error(`Buy failed after ${maxRetries} attempts: ${lastErrorMsg || lastError?.message || 'Unknown error'}`);
}

/**
 * 🔥 Helper: Quick check if trading is enabled
 */
export async function checkTradingEnabled({ provider, router, weth, token, testAmount = null }) {
  const testWei = testAmount || ethers.parseEther('0.0001'); // Very small test
  const deadline = Math.floor(Date.now() / 1000) + 120;
  const routerContract = new ethers.Contract(router, IUniswapV2Router, provider);
  
  try {
    await routerContract.swapExactETHForTokensSupportingFeeOnTransferTokens.staticCall(
      0n,
      [weth, token],
      await provider.getSigner().getAddress(),
      deadline,
      { value: testWei }
    );
    
    return { enabled: true, method: 'FOT' };
  } catch (error) {
    // Try standard swap
    try {
      await routerContract.swapExactETHForTokens.staticCall(
        0n,
        [weth, token],
        await provider.getSigner().getAddress(),
        deadline,
        { value: testWei }
      );
      
      return { enabled: true, method: 'standard' };
    } catch (error2) {
      return { 
        enabled: false, 
        reason: error.message.includes('TRANSFER_FROM_FAILED') ? 'Trading not enabled' :
                error.message.includes('INSUFFICIENT_OUTPUT') ? 'No liquidity' :
                error.message.includes('Blacklist') ? 'Address blacklisted' :
                'Unknown reason'
      };
    }
  }
}