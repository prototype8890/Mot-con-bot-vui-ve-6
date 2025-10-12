import { ethers } from 'ethers';
import { keccak256, toUtf8Bytes } from 'ethers';

/**
 * 🛡️ SCAM DETECTION FOR PUMP & DUMP SCHEMES
 * Phát hiện các trick thường gặp trong pump & dump
 */

// ════════════════════════════════════════════════════════════
// 1. BLACKLIST DETECTION
// ════════════════════════════════════════════════════════════

export function detectBlacklistMechanism(bytecode) {
  const suspicious = [
    // Blacklist keywords
    'blacklist',
    'blacklisted', 
    '_blacklist',
    'isBlacklisted',
    'addBlacklist',
    'removeBlacklist',
    
    // Bot tracking
    '_isBot',
    '_bots',
    'isBot',
    'addBot',
    
    // Exclusion lists
    '_excluded',
    '_isExcluded',
    'excludeFromFee',
    'excludeFromReward'
  ];

  const code = bytecode.toLowerCase();
  const found = [];

  for (const keyword of suspicious) {
    const hash = keccak256(toUtf8Bytes(keyword)).slice(2, 10);
    if (code.includes(hash)) {
      found.push(keyword);
    }
  }

  return {
    hasBlacklist: found.length > 0,
    keywords: found,
    risk: found.length >= 3 ? 'HIGH' : found.length >= 1 ? 'MEDIUM' : 'LOW'
  };
}

// ════════════════════════════════════════════════════════════
// 2. MAX TX AMOUNT DETECTION
// ════════════════════════════════════════════════════════════

export async function detectMaxTxLimit({ provider, token, expectedBuyAmount }) {
  try {
    const iface = new ethers.Interface([
      'function maxTxAmount() view returns (uint256)',
      'function _maxTxAmount() view returns (uint256)',
      'function maxTransactionAmount() view returns (uint256)',
      'function totalSupply() view returns (uint256)'
    ]);

    // Try to read max tx amount
    let maxTx = null;
    for (const funcName of ['maxTxAmount', '_maxTxAmount', 'maxTransactionAmount']) {
      try {
        const data = iface.encodeFunctionData(funcName, []);
        const result = await provider.call({ to: token, data });
        maxTx = ethers.toBigInt(result);
        break;
      } catch {}
    }

    if (!maxTx) {
      return { hasLimit: false, safe: true };
    }

    // Get total supply
    let totalSupply = 0n;
    try {
      const data = iface.encodeFunctionData('totalSupply', []);
      const result = await provider.call({ to: token, data });
      totalSupply = ethers.toBigInt(result);
    } catch {
      return { hasLimit: true, safe: false, reason: 'cannot_check_supply' };
    }

    // Calculate % of supply
    const maxTxPercent = Number((maxTx * 10000n) / totalSupply) / 100;

    // If max TX < 0.5% of supply = very restrictive
    if (maxTxPercent < 0.5) {
      return {
        hasLimit: true,
        safe: false,
        maxTxPercent,
        reason: `Max TX only ${maxTxPercent.toFixed(2)}% of supply (too low)`
      };
    }

    return {
      hasLimit: true,
      safe: true,
      maxTxPercent
    };

  } catch (e) {
    return { hasLimit: false, safe: true, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════
// 3. COOLDOWN DETECTION
// ════════════════════════════════════════════════════════════

export function detectCooldownMechanism(bytecode) {
  const cooldownPatterns = [
    'cooldown',
    '_cooldown',
    'lastBuy',
    '_lastBuy',
    'lastTransaction',
    'buyCooldown',
    'transferCooldown'
  ];

  const code = bytecode.toLowerCase();
  const found = [];

  for (const pattern of cooldownPatterns) {
    const hash = keccak256(toUtf8Bytes(pattern)).slice(2, 10);
    if (code.includes(hash)) {
      found.push(pattern);
    }
  }

  return {
    hasCooldown: found.length > 0,
    patterns: found,
    risk: found.length > 0 ? 'HIGH' : 'LOW',
    warning: found.length > 0 ? 'May not be able to sell immediately' : null
  };
}

// ════════════════════════════════════════════════════════════
// 4. OWNERSHIP RISK ASSESSMENT
// ════════════════════════════════════════════════════════════

export async function assessOwnershipRisk({ provider, token }) {
  try {
    const iface = new ethers.Interface([
      'function owner() view returns (address)',
      'function getOwner() view returns (address)',
      'function renounceOwnership() external',
      'function transferOwnership(address) external'
    ]);

    // Get owner
    let owner = null;
    for (const funcName of ['owner', 'getOwner']) {
      try {
        const data = iface.encodeFunctionData(funcName, []);
        const result = await provider.call({ to: token, data });
        owner = ethers.getAddress('0x' + result.slice(26));
        break;
      } catch {}
    }

    if (!owner) {
      return { hasOwner: false, risk: 'LOW', reason: 'No owner function' };
    }

    // Check if owner is zero address (renounced)
    if (owner === '0x0000000000000000000000000000000000000000') {
      return { 
        hasOwner: false, 
        renounced: true,
        risk: 'LOW',
        reason: 'Ownership renounced' 
      };
    }

    // Owner exists = can rug
    return {
      hasOwner: true,
      owner,
      renounced: false,
      risk: 'HIGH',
      reason: 'Owner can modify contract'
    };

  } catch (e) {
    return { hasOwner: false, risk: 'UNKNOWN', error: e.message };
  }
}

// ════════════════════════════════════════════════════════════
// 5. BOT PATTERN DETECTION (From pair activity)
// ════════════════════════════════════════════════════════════

export async function detectBotFarmPattern({ provider, pair, weth, minSamples = 5 }) {
  try {
    const pairContract = new ethers.Contract(
      pair,
      ['event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)'],
      provider
    );

    const currentBlock = await provider.getBlockNumber();
    const fromBlock = currentBlock - 50; // Last 50 blocks (~10 minutes)

    const swaps = await pairContract.queryFilter(
      pairContract.filters.Swap(),
      fromBlock,
      currentBlock
    );

    if (swaps.length < minSamples) {
      return { 
        detected: false, 
        reason: 'Not enough samples',
        samples: swaps.length 
      };
    }

    // Analyze swap patterns
    const buyers = new Map(); // address -> [amounts]
    const blocks = new Map(); // block -> count

    for (const swap of swaps) {
      const { sender, to, amount0In, amount1In, amount0Out, amount1Out } = swap.args;
      const block = swap.blockNumber;

      // Detect buy (ETH in, token out)
      const isBuy = (amount0In > 0 && amount1Out > 0) || (amount1In > 0 && amount0Out > 0);
      
      if (isBuy) {
        const buyer = to;
        const ethAmount = amount0In > 0 ? amount0In : amount1In;

        if (!buyers.has(buyer)) {
          buyers.set(buyer, []);
        }
        buyers.get(buyer).push({ ethAmount, block });

        blocks.set(block, (blocks.get(block) || 0) + 1);
      }
    }

    // Pattern 1: Multiple wallets buying similar amounts
    const amounts = Array.from(buyers.values()).flat().map(b => Number(ethers.formatEther(b.ethAmount)));
    const avgAmount = amounts.reduce((a,b) => a+b, 0) / amounts.length;
    const variance = amounts.reduce((sum, amt) => sum + Math.pow(amt - avgAmount, 2), 0) / amounts.length;
    const stdDev = Math.sqrt(variance);
    
    // Low variance = coordinated buying
    const isCoordinated = stdDev / avgAmount < 0.3; // < 30% variation

    // Pattern 2: Regular interval blocks
    const blockNumbers = Array.from(blocks.keys()).sort((a,b) => a-b);
    const intervals = [];
    for (let i = 1; i < blockNumbers.length; i++) {
      intervals.push(blockNumbers[i] - blockNumbers[i-1]);
    }
    const avgInterval = intervals.reduce((a,b) => a+b, 0) / intervals.length;
    const isRegularInterval = intervals.every(i => Math.abs(i - avgInterval) <= 2); // Within 2 blocks

    // Pattern 3: Multiple unique wallets
    const uniqueBuyers = buyers.size;
    const hasMultipleBuyers = uniqueBuyers >= 3;

    // Verdict
    const botFarmScore = 
      (isCoordinated ? 40 : 0) +
      (isRegularInterval ? 30 : 0) +
      (hasMultipleBuyers ? 30 : 0);

    return {
      detected: botFarmScore >= 60,
      confidence: botFarmScore,
      patterns: {
        coordinated: isCoordinated,
        regularInterval: isRegularInterval,
        multipleBuyers: hasMultipleBuyers
      },
      stats: {
        uniqueBuyers,
        totalBuys: swaps.length,
        avgBuyAmount: avgAmount.toFixed(4),
        stdDev: stdDev.toFixed(4),
        avgBlockInterval: avgInterval.toFixed(1)
      },
      risk: botFarmScore >= 80 ? 'VERY_HIGH' : 
            botFarmScore >= 60 ? 'HIGH' : 
            botFarmScore >= 40 ? 'MEDIUM' : 'LOW'
    };

  } catch (e) {
    return { detected: false, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════
// 6. COMPREHENSIVE SCAM SCORE
// ════════════════════════════════════════════════════════════

export async function calculateScamScore({ provider, token, pair, weth, bytecode }) {
  console.log('[ScamDetection] Running comprehensive analysis...');

  const [
    blacklistCheck,
    maxTxCheck,
    cooldownCheck,
    ownerCheck,
    botPatternCheck
  ] = await Promise.all([
    Promise.resolve(detectBlacklistMechanism(bytecode)),
    detectMaxTxLimit({ provider, token, expectedBuyAmount: ethers.parseEther('0.01') }),
    Promise.resolve(detectCooldownMechanism(bytecode)),
    assessOwnershipRisk({ provider, token }),
    detectBotFarmPattern({ provider, pair, weth })
  ]);

  // Calculate score (0-100, higher = more scammy)
  let score = 0;
  const reasons = [];

  // Blacklist mechanisms (+30)
  if (blacklistCheck.hasBlacklist) {
    score += blacklistCheck.risk === 'HIGH' ? 30 : 20;
    reasons.push(`Blacklist mechanism detected (${blacklistCheck.keywords.join(', ')})`);
  }

  // Max TX restrictions (+20)
  if (maxTxCheck.hasLimit && !maxTxCheck.safe) {
    score += 20;
    reasons.push(maxTxCheck.reason);
  }

  // Cooldown (+15)
  if (cooldownCheck.hasCooldown) {
    score += 15;
    reasons.push('Cooldown mechanism detected');
  }

  // Owner not renounced (+20)
  if (ownerCheck.hasOwner && !ownerCheck.renounced) {
    score += 20;
    reasons.push('Owner not renounced - can rug');
  }

  // Bot farm pattern (+15)
  if (botPatternCheck.detected) {
    score += 15;
    reasons.push(`Bot farm detected (confidence: ${botPatternCheck.confidence}%)`);
  }

  const verdict = 
    score >= 70 ? 'VERY_HIGH_RISK' :
    score >= 50 ? 'HIGH_RISK' :
    score >= 30 ? 'MEDIUM_RISK' : 'LOW_RISK';

  return {
    score,
    verdict,
    reasons,
    details: {
      blacklist: blacklistCheck,
      maxTx: maxTxCheck,
      cooldown: cooldownCheck,
      owner: ownerCheck,
      botPattern: botPatternCheck
    },
    recommendation: score >= 70 ? 'SKIP - Too risky' :
                    score >= 50 ? 'PROCEED WITH CAUTION - High risk' :
                    score >= 30 ? 'ACCEPTABLE - Monitor closely' :
                    'RELATIVELY SAFE'
  };
}

// ════════════════════════════════════════════════════════════
// 7. QUICK SCAM CHECK (Fast version)
// ════════════════════════════════════════════════════════════

export async function quickScamCheck({ provider, token, bytecode }) {
  // Only check critical flags (fast)
  const blacklist = detectBlacklistMechanism(bytecode);
  const cooldown = detectCooldownMechanism(bytecode);

  const isSuspicious = 
    (blacklist.hasBlacklist && blacklist.risk === 'HIGH') ||
    cooldown.hasCooldown;

  return {
    suspicious: isSuspicious,
    reason: isSuspicious ? 
      [...(blacklist.hasBlacklist ? ['blacklist'] : []),
       ...(cooldown.hasCooldown ? ['cooldown'] : [])].join(', ') : null
  };
}