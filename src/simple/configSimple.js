import { z } from 'zod';

function parseBool(x){ return String(x).toLowerCase()==='1' || String(x).toLowerCase()==='true'; }
function list(x){ return String(x||'').split(',').map(s=>s.trim()).filter(Boolean); }

export function loadSimpleEnv(){
  const schema = z.object({
    RPC_URLS: z.string().min(1),
    PRIVATE_KEY: z.string().startsWith('0x'),
    WALLET_ADDRESS: z.string().startsWith('0x').length(42),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_CHAT_ID: z.string().optional(),
    WETH: z.string().startsWith('0x').length(42).default('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
    ROUTER_V2: z.string().startsWith('0x').length(42).default('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'),
    ENTRY_MODE: z.string().default('EARLIEST'),
    PRICE_GUARD: z.string().optional(),
    PRICE_MULTIPLE_ABORT: z.coerce.number().default(3),
    RUG_DEFENSE: z.string().optional(),
    RUG_THRESHOLD_BP: z.coerce.number().default(2000),
    PANIC_DEADLINE_SEC: z.coerce.number().default(60),
    PANIC_TIP_ADD_GWEI: z.coerce.number().default(0.2),
    TP_PCT: z.coerce.number().default(20),
    MAX_REPLACEMENTS: z.coerce.number().default(5),
    TX_REPLACE_MS: z.coerce.number().default(1500),
    MAX_FEE_GWEI_CAP: z.coerce.number().default(300),
    MAX_PRIORITY_FEE_GWEI_CAP: z.coerce.number().default(200),
  });
  const parsed = schema.parse(process.env);
  return {
    ...parsed,
    RPC_URLS: list(parsed.RPC_URLS),
    ENTRY_MODE: (parsed.ENTRY_MODE||'EARLIEST').toUpperCase(),
    PRICE_GUARD: parseBool(parsed.PRICE_GUARD||'1'),
    RUG_DEFENSE: parseBool(parsed.RUG_DEFENSE||'1')
  };
}
