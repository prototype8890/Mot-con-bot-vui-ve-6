import { ethers } from 'ethers';
import { loadEnv } from './config.js';
import { createTg } from './telegram.js';
import { CircuitBreaker } from './circuitBreaker.js';
import { NonceManager } from './nonceManager.js';
import { IUniswapV2Pair, IUniswapV2Router, readReserves, pickWethReserve } from './exchange/uniswapV2.js';
import { simulateBuySell } from './simulate.js';
import { calcMinOut } from './slippage.js';

const cfg = loadEnv();
const providers = cfg.RPC_URLS.map(u => new ethers.JsonRpcProvider(u));
const provider = providers[0];
const wallet = new ethers.Wallet(cfg.PRIVATE_KEY, provider);
const tg = createTg(cfg.TELEGRAM_BOT_TOKEN, cfg.TELEGRAM_CHAT_ID);

const cb = new CircuitBreaker({
  maxFailRate: cfg.MAX_FAIL_RATE,
  windowSec: cfg.FAIL_RATE_WINDOW_SEC,
  maxRpcErrors: cfg.MAX_CONSECUTIVE_RPC_ERRORS,
  maxBlockDelayMs: cfg.MAX_BLOCK_DELAY_MS
}, tg);

const nonceMgr = new NonceManager(await provider.getTransactionCount(wallet.address));

// Mainnet constants
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'; // UniswapV2

async function sendViaRelaysOrPublic(rawTx) {
  // Dynamic import to keep deps localized to relay files in your tree
  const { tryAllRelays } = await import('./relays/tryAllRelays.js');
  const r = await tryAllRelays(cfg.RELAYS, rawTx);
  if (r.success) return r.txHash;
  // fallback public
  const txHash = await provider.send('eth_sendRawTransaction', [rawTx]);
  return txHash;
}

export async function evaluatePair({ pairAddr, tokenAddr, buyEth = '0.01' }) {
  try {
    // Pair checks
    const pair = new ethers.Contract(pairAddr, IUniswapV2Pair, provider);
    const [token0, token1] = await Promise.all([pair.token0(), pair.token1()]);
    const [reserve0, reserve1] = await readReserves(provider, pairAddr);
    const rWeth = pickWethReserve({ token0, token1, reserve0, reserve1, weth: WETH });
    if (rWeth === 0n) throw new Error('Pair has no WETH side');
    const rEth = Number(rWeth) / 1e18;
    if (rEth < cfg.MIN_WETH_LP_ETH || rEth > cfg.MAX_WETH_LP_ETH) throw new Error('LP out of range');

    // Simulate buy->sell
    const amountInWei = ethers.parseEther(buyEth);
    const sim = await simulateBuySell({ provider, router: ROUTER, weth: WETH, token: tokenAddr, amountInWei, wallet: wallet.address });

    // Build buy tx
    const path = [WETH, tokenAddr];
    const deadline = Math.floor(Date.now()/1000) + 300;
    const minOut = calcMinOut(sim.amountOutBuy, cfg.MAX_SLIPPAGE_BPS);
    const data = IUniswapV2Router.encodeFunctionData('swapExactETHForTokens', [minOut, path, wallet.address, deadline]);

    const feeData = await provider.getFeeData();
    const maxFeePerGas = feeData.maxFeePerGas || 0n;
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || 1_000_000_000n;
    const tx = { to: ROUTER, data, value: amountInWei, maxFeePerGas, maxPriorityFeePerGas, nonce: nonceMgr.next() };

    const signed = await wallet.signTransaction(tx);
    const txHash = await sendViaRelaysOrPublic(signed);

    cb.record(true);
    await tg?.send([
      'BUY SENT',
      `pair: ${pairAddr}`,
      `token: ${tokenAddr}`,
      `eth_in: ${buyEth}`,
      `minOut: ${minOut.toString()}`,
      `tx: https://etherscan.io/tx/${txHash}`
    ].join('\n'));
    return { ok: true, txHash };
  } catch (e) {
    cb.record(false);
    await tg?.send(`SKIP ${tokenAddr}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Example usage (remove in prod)
if (process.env.DEMO_PAIR && process.env.DEMO_TOKEN) {
  evaluatePair({ pairAddr: process.env.DEMO_PAIR, tokenAddr: process.env.DEMO_TOKEN }).then(()=>{});
} else {
  console.log('Patch loaded. Call evaluatePair({ pairAddr, tokenAddr, buyEth }) from your discovery flow.');
}
