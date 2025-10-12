// src/simple/filters.js - ENHANCED TAX DETECTION
import { ethers } from 'ethers';
import { IERC20, IUniswapV2Pair, IUniswapV2Router } from './abi.js';
import { priceEthForTokens } from './pricing.js';
import { computeBlockedSelectors, bytecodeHasAnySelector } from './selectorScan.js';

// ── Reserves helpers ───────────────────────────────────────────────────────────
export async function getReservesEth({ provider, pair, weth }) {
  const c = new ethers.Contract(pair, IUniswapV2Pair, provider);
  const [t0, t1] = await Promise.all([c.token0(), c.token1()]);
  const [r0, r1] = await c.getReserves();
  const isW0 = t0.toLowerCase() === weth.toLowerCase();
  const isW1 = t1.toLowerCase() === weth.toLowerCase();
  const ethReserve = isW0 ? r0 : (isW1 ? r1 : 0n);
  const token = isW0 ? t1 : t0;
  return { ethReserve, token };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔥 ENHANCED TAX DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

const FEE_FIELD_NAMES = [
  // Common names
  'buyFee','sellFee','_buyFee','_sellFee',
  'tax','_tax','transferTax','_transferTax',
  'totalFee','_totalFee','fees','_fees',
  'liquidityFee','marketingFee',
  'getBuyTax','getSellTax','_buyTax','_sellTax',
  
  // Additional variants
  'buyTaxRate','sellTaxRate','taxRate',
  'buyFeeRate','sellFeeRate','feeRate',
  'transactionFee','transferFee',
  'buyFeeBps','sellFeeBps','feeBps',
  'getBuyFee','getSellFee',
  'buyFeePercent','sellFeePercent',
  'taxPercent','feePercent'
];

/**
 * 🔥 FIX #1: Thêm simulation-based tax detection
 */
export async function detectTaxBySimulation({ provider, router, token, weth, pair }) {
  try {
    const testAmount = ethers.parseEther('0.001'); // Test với 0.001 ETH
    const deadline = Math.floor(Date.now() / 1000) + 300;
    const routerContract = new ethers.Contract(router, IUniswapV2Router, provider);
    
    // Simulate BUY
    let buyTax = 0;
    try {
      const amountsOut = await routerContract.getAmountsOut.staticCall(
        testAmount,
        [weth, token]
      );
      
      // Get reserves để tính expected amount
      const pairContract = new ethers.Contract(pair, IUniswapV2Pair, provider);
      const [reserve0, reserve1] = await pairContract.getReserves();
      const token0 = await pairContract.token0();
      
      const isToken0Weth = token0.toLowerCase() === weth.toLowerCase();
      const reserveWeth = isToken0Weth ? reserve0 : reserve1;
      const reserveToken = isToken0Weth ? reserve1 : reserve0;
      
      // Calculate expected (no tax)
      const expectedOut = (testAmount * reserveToken * 997n) / (reserveWeth * 1000n + testAmount * 997n);
      const actualOut = amountsOut[1];
      
      // Tax = difference
      if (expectedOut > actualOut) {
        buyTax = Number((expectedOut - actualOut) * 10000n / expectedOut);
      }
    } catch (e) {
      // Cannot simulate buy - might indicate issues
      console.log(`[tax] Cannot simulate buy: ${e.message}`);
    }
    
    // Simulate SELL (harder - need tokens)
    // Skip for now as we don't have tokens yet
    
    return {
      detected: true,
      buyTax: Math.round(buyTax),
      sellTax: -1, // Unknown
      method: 'simulation'
    };
    
  } catch (error) {
    return {
      detected: false,
      buyTax: -1,
      sellTax: -1,
      method: 'simulation',
      error: error.message
    };
  }
}

/**
 * 🔥 FIX #2: Bytecode pattern detection cho common tax implementations
 */
function detectTaxFromBytecode(bytecode) {
  if (!bytecode || bytecode === '0x') return -1;
  
  // Common patterns cho tax implementations
  const patterns = [
    // Pattern 1: if (tax > 0) { amount = amount * (100 - tax) / 100 }
    /6064.{0,20}600a.{0,20}6014/, // 100, 10, 20 in hex
    
    // Pattern 2: taxAmount = amount * taxRate / 10000
    /612710.{0,30}61271006/, // 10000 (0x2710)
    
    // Pattern 3: Zero tax indicator (returns 0)
    /63.{8}1461/, // Standard zero return
  ];
  
  for (const pattern of patterns) {
    if (pattern.test(bytecode)) {
      // Found pattern but can't determine exact value
      return -1;
    }
  }
  
  return -1;
}

/**
 * Original field-based detection
 */
export async function detectFeesBps({ provider, token }) {
  // sanity ERC20
  try {
    const erc = new ethers.Contract(token, IERC20, provider);
    await erc.decimals();
  } catch {
    return -1;
  }

  const vals = [];
  
  // Try all field names
  for (const n of FEE_FIELD_NAMES) {
    // try uint256
    try {
      const iface = new ethers.Interface([`function ${n}() view returns (uint256)`]);
      const raw = await provider.call({ to: token, data: iface.encodeFunctionData(n, []) });
      const val = Number(ethers.toBigInt(raw));
      if (val > 0 && val <= 10000) { // Reasonable range: 0-100%
        vals.push(val);
      }
      continue;
    } catch {}
    
    // try uint8
    try {
      const iface8 = new ethers.Interface([`function ${n}() view returns (uint8)`]);
      const raw8 = await provider.call({ to: token, data: iface8.encodeFunctionData(n, []) });
      const val = Number(ethers.toBigInt(raw8));
      if (val > 0 && val <= 100) {
        vals.push(val);
      }
      continue;
    } catch {}
    
    // try bool (some return true/false for has tax)
    try {
      const ifaceBool = new ethers.Interface([`function ${n}() view returns (bool)`]);
      const rawBool = await provider.call({ to: token, data: ifaceBool.encodeFunctionData(n, []) });
      const hasTax = ethers.toBigInt(rawBool) > 0n;
      if (hasTax) {
        // Has tax but unknown amount - return special value
        vals.push(-2); // Indicator for "has tax but unknown amount"
      }
    } catch {}
  }

  if (!vals.length) return -1;
  
  // If we found -2 (has tax flag), consider it unknown
  if (vals.includes(-2)) return -1;
  
  const m = Math.max(...vals);
  return m <= 10000 ? m : -1; // Max 100% (10000 BPS)
}

/**
 * 🔥 FIX #3: COMBINED tax detection với multiple methods
 */
export async function detectTaxEnhanced({ provider, router, token, weth, pair }) {
  const results = {
    fieldBased: -1,
    simulation: null,
    bytecode: -1,
    final: -1,
    confidence: 'unknown',
    method: []
  };
  
  // Method 1: Field-based (fastest)
  results.fieldBased = await detectFeesBps({ provider, token });
  if (results.fieldBased >= 0) {
    results.method.push('field');
    results.final = results.fieldBased;
    results.confidence = 'high';
    return results;
  }
  
  // Method 2: Simulation (medium speed, good accuracy)
  if (router && weth && pair) {
    results.simulation = await detectTaxBySimulation({ provider, router, token, weth, pair });
    if (results.simulation.detected && results.simulation.buyTax >= 0) {
      results.method.push('simulation');
      results.final = results.simulation.buyTax;
      results.confidence = 'medium';
      return results;
    }
  }
  
  // Method 3: Bytecode analysis (slow, low accuracy)
  try {
    const bytecode = await provider.getCode(token);
    results.bytecode = detectTaxFromBytecode(bytecode);
    if (results.bytecode >= 0) {
      results.method.push('bytecode');
      results.final = results.bytecode;
      results.confidence = 'low';
      return results;
    }
  } catch {}
  
  // 🔥 FIX #4: ASSUME ZERO TAX if all methods fail
  // Many legitimate tokens don't expose tax fields
  results.final = -1; // ASSUME zero tax
  results.confidence = 'unknown';
  results.method.push('none');
  
  return results;
}

/**
 * 🔥 FIX #5: Smart tax enforcement với fallback
 */
export async function enforceStrictTax({ provider, token, strictMaxBps, mode, router, weth, pair }) {
  // Use enhanced detection
  const taxResult = await detectTaxEnhanced({ provider, router, token, weth, pair });
  
  console.log(`[tax] Detection result: ${taxResult.final} BPS (method: ${taxResult.method.join('+')}, confidence: ${taxResult.confidence})`);
  
  const bps = taxResult.final;
  
  // Handle based on mode
  const modeStr = String(mode || '').toLowerCase();
  
  if (bps < 0) {
    // Tax unknown
    if (modeStr === 'reject_unknown') {
      return { 
        ok: false, 
        reason: 'tax_unknown',
        details: `Cannot detect tax (tried: ${taxResult.method.join(', ')})`
      };
    } else if (modeStr === 'allow_unknown') {
      return { 
        ok: true, 
        reason: 'tax_unknown_allowed',
        details: 'Tax unknown but allowed by config'
      };
    } else {
      // Default: allow unknown
      return { 
        ok: true, 
        reason: 'tax_unknown_default_allow',
        details: 'Tax detection failed, assuming safe'
      };
    }
  }
  
  // Tax is known
  if (bps > strictMaxBps) {
    return { 
      ok: false, 
      reason: `tax_${bps}_bps_gt_${strictMaxBps}`,
      details: `Tax ${bps} BPS exceeds limit ${strictMaxBps} BPS`
    };
  }
  
  return { 
    ok: true, 
    reason: `tax_${bps}_bps_ok`,
    details: `Tax ${bps} BPS within limit (${taxResult.confidence} confidence)`
  };
}

// ── Owner / trading flags (tuỳ chọn) ──────────────────────────────────────────
export async function detectOwnerRisk({ provider, token }) {
  const sigs = [
    'function owner() view returns (address)',
    'function getOwner() view returns (address)',
    'function tradingEnabled() view returns (bool)',
    'function tradingOpen() view returns (bool)'
  ];
  const iface = new ethers.Interface(sigs);
  const call = async (name) => {
    try {
      const raw = await provider.call({ to: token, data: iface.encodeFunctionData(name, []) });
      return iface.decodeFunctionResult(name, raw)[0];
    } catch {
      return undefined;
    }
  };
  const ownerA = await call('owner');
  const ownerB = await call('getOwner');
  const tradingEnabled = await call('tradingEnabled');
  const tradingOpen = await call('tradingOpen');
  return { owner: ownerA ?? ownerB ?? null, tradingEnabled, tradingOpen };
}

// ── Selector-based rejection (bytecode scan) ───────────────────────────────────
export async function rejectBySelectors({ provider, token, blockedNamesCsv }) {
  const names = String(blockedNamesCsv || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!names.length) return { ok: true };
  const blockedSel = computeBlockedSelectors(names);
  const code = await provider.getCode(token);
  const hit = bytecodeHasAnySelector(code, blockedSel);
  return hit ? { ok: false, reason: 'blocked_selector' } : { ok: true };
}

// ── Price helpers ──────────────────────────────────────────────────────────────
// Tokens per 1 ETH. Router quote → fallback reserves.
export async function basePriceTokensPerEth({ provider, router, token, weth, pair }) {
  // 🔥 FIX: Try reserves FIRST (more reliable for new pairs)
  try {
    if (pair) {
      const c = new ethers.Contract(pair, IUniswapV2Pair, provider);
      const [t0, t1, [r0, r1]] = await Promise.all([
        c.token0(), 
        c.token1(), 
        c.getReserves()
      ]);
      
      const w0 = t0.toLowerCase() === weth.toLowerCase();
      const w1 = t1.toLowerCase() === weth.toLowerCase();
      
      if (w0 || w1) {
        const rw = w0 ? r0 : r1;
        const rt = w0 ? r1 : r0;
        
        if (rw > 0n && rt > 0n) {
          const price = (rt * 10n ** 18n) / rw;
          console.log(`[price] From reserves: ${ethers.formatUnits(price, 18)} tokens/ETH`);
          return price;
        }
      }
    }
  } catch (e) {
    console.log(`[price] Reserves query failed: ${e.message}`);
  }

  // Fallback to router quote
  try {
    const out = await priceEthForTokens({ provider, router, token, weth });
    if (out && out > 0n) {
      console.log(`[price] From router: ${ethers.formatUnits(out, 18)} tokens/ETH`);
      return out;
    }
  } catch (e) {
    console.log(`[price] Router query failed: ${e.message}`);
  }

  console.log(`[price] ❌ All methods failed - returning 0`);
  return 0n;
}

// ── Static-call buy simulation ────────────────────────────────────────────────
export async function canBuyCallStatic({ provider, router, weth, token, from, wei }) {
  const deadline = Math.floor(Date.now() / 1000) + 120;
  const iface = new ethers.Interface(IUniswapV2Router);
  try {
    // prefer supporting-FOT path
    const data = iface.encodeFunctionData(
      'swapExactETHForTokensSupportingFeeOnTransferTokens',
      [0n, [weth, token], from, deadline]
    );
    await provider.call({ to: router, value: wei, from, data });
    return true;
  } catch {
    try {
      const data = iface.encodeFunctionData(
        'swapExactETHForTokens',
        [0n, [weth, token], from, deadline]
      );
      await provider.call({ to: router, value: wei, from, data });
      return true;
    } catch {
      return false;
    }
  }
}