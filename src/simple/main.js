import { ethers } from 'ethers';
import { loadSimpleEnv } from './configSimple.js';
import { ERC20, IUniswapV2Router } from './abi.js';
import { snapshotP0, currentPrice, aboveMultiple } from './priceGuard.js';
import { broadcastASAP } from './broadcast.js';
import { makePanicSell } from './panicSell.js';
import { watchRug } from './mempoolWatcher.js';
import { createTg } from '../telegram.js';

function getArgs(){
  const args = Object.fromEntries(process.argv.slice(2).map((v,i,arr)=> v.startsWith('--')? [v.slice(2), arr[i+1]]:[]).filter(Boolean));
  return args;
}

async function main(){
  const cfg = loadSimpleEnv();
  const args = getArgs();
  if (!args.pair || !args.token || !args.buyEth) {
    console.log('Usage: node src/simple/main.js --pair 0x... --token 0x... --buyEth 0.1');
    process.exit(1);
  }
  const provider = new ethers.JsonRpcProvider(cfg.RPC_URLS[0]);
  const wallet = new ethers.Wallet(cfg.PRIVATE_KEY, provider);
  const router = new ethers.Contract(cfg.ROUTER_V2, IUniswapV2Router, provider).connect(wallet);
  const tg = cfg.TELEGRAM_BOT_TOKEN && cfg.TELEGRAM_CHAT_ID ? 
    createTg(cfg.TELEGRAM_BOT_TOKEN, cfg.TELEGRAM_CHAT_ID) : null;

  const pair = args.pair;
  const token = args.token;
  const buyEth = ethers.parseEther(String(args.buyEth));

  // 1) price guard
  const p0 = await snapshotP0(provider, pair, cfg.WETH.toLowerCase(), token.toLowerCase());
  if (cfg.PRICE_GUARD){
    const pNow = await currentPrice(provider, pair, cfg.WETH.toLowerCase(), token.toLowerCase());
    if (aboveMultiple(pNow, p0, cfg.PRICE_MULTIPLE_ABORT)) {
      await tg?.send(`ABORT: price >= ${cfg.PRICE_MULTIPLE_ABORT}x initial`);
      console.log('Abort by price guard');
      process.exit(0);
    }
  }

  // 2) buy ASAP
  const path = [cfg.WETH, token];
  const deadline = Math.floor(Date.now()/1000) + 120;
  const buyData = router.interface.encodeFunctionData('swapExactETHForTokens', [ 0n, path, wallet.address, deadline ]);
  const buyRcpt = await broadcastASAP({ wallet, provider, tx: { to: cfg.ROUTER_V2, data: buyData, value: buyEth }, maxReplacements: cfg.MAX_REPLACEMENTS, replaceMs: cfg.TX_REPLACE_MS });
  await tg?.send(`BUY OK: ${buyRcpt.hash}`);

  // 3) arm panic sell watcher
  const panic = makePanicSell({ provider, wallet, routerAddr: cfg.ROUTER_V2, tokenAddr: token, wethAddr: cfg.WETH, addPrioGwei: cfg.PANIC_TIP_ADD_GWEI, deadlineSec: cfg.PANIC_DEADLINE_SEC });
  if (cfg.RUG_DEFENSE){
    watchRug({ provider, pair, routers:[cfg.ROUTER_V2], thresholdBp: cfg.RUG_THRESHOLD_BP, onThreat: async ({ rivalTip, kind, hash })=>{
      await tg?.send(`RUG ALERT (${kind}): ${hash} → panic sell`);
      const r = await panic.sellAll({ rivalTip });
      if (r.sold) await tg?.send(`PANIC SELL OK: ${r.txHash}`);
    }});
  }

  // 4) take profit watcher
  const entry = await currentPrice(provider, pair, cfg.WETH.toLowerCase(), token.toLowerCase());
  const tpWatcher = (await import('./takeProfit.js')).runTpWatcher({
    provider, pair, base: cfg.WETH.toLowerCase(), quote: token.toLowerCase(), entryPrice: entry, tpPct: cfg.TP_PCT,
    onTp: async (p)=> {
      await tg?.send(`TP HIT @ ${p} → SELL ALL`);
      const r = await panic.sellAll({});
      if (r.sold) await tg?.send(`TP SELL OK: ${r.txHash}`);
    }
  });

  // 5) log
  await tg?.send(`BOT READY: simple mode; pair=${pair}`);

}
main().catch(async (e)=>{ console.error(e); process.exit(1); });
