import fs from 'fs';
import { z } from 'zod';

function parseBool(s) { return String(s).toLowerCase() === 'true'; }

const schema = z.object({
  RPC_URLS: z.string().min(1),
  RELAYS: z.string().min(1),
  PRIVATE_KEY: z.string().startsWith('0x').min(10),
  WALLET_ADDRESS: z.string().startsWith('0x').length(42),
  MIN_WETH_LP_ETH: z.coerce.number().positive(),
  MAX_WETH_LP_ETH: z.coerce.number().positive(),
  REQUIRE_TAX_ZERO: z.string().transform(parseBool),
  MAX_BUY_TAX_BPS: z.coerce.number().int().nonnegative(),
  MAX_SELL_TAX_BPS: z.coerce.number().int().nonnegative(),
  MAX_SLIPPAGE_BPS: z.coerce.number().int().positive(),
  DCA_SLICES: z.coerce.number().int().min(1).max(5),
  MAX_FAIL_RATE: z.coerce.number().min(0).max(1),
  FAIL_RATE_WINDOW_SEC: z.coerce.number().int().positive(),
  MAX_CONSECUTIVE_RPC_ERRORS: z.coerce.number().int().positive(),
  MAX_BLOCK_DELAY_MS: z.coerce.number().int().positive(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  DEXSCREENER_URL: z.string().optional(),
  GOPLUS_URL: z.string().optional(),
  HONEYPOTIS_URL: z.string().optional(),
  TRADE_ON_V3: z.string().optional()
});

export function loadEnv(path='.env') {
  const txt = fs.existsSync(path) ? fs.readFileSync(path,'utf8') : '';
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
  const parsed = schema.parse(process.env);
  const cfg = {
    ...parsed,
    RPC_URLS: parsed.RPC_URLS.split(',').map(s=>s.trim()).filter(Boolean),
    RELAYS: parsed.RELAYS.split(',').map(s=>s.trim()).filter(Boolean),
    TRADE_ON_V3: (parsed.TRADE_ON_V3||'false').toLowerCase()==='true'
  };
  if (cfg.MIN_WETH_LP_ETH > cfg.MAX_WETH_LP_ETH) throw new Error('MIN_WETH_LP_ETH > MAX_WETH_LP_ETH');
  return cfg;
}
