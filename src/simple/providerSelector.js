import { ethers } from 'ethers';

/**
 * 🔧 FIX #3: Smart provider selector
 * Ưu tiên WSS cho mempool, fallback HTTP nếu cần
 */

export function makeProvider(url) {
  const trimmed = url.trim();
  
  if (trimmed.startsWith('wss://') || trimmed.startsWith('ws://')) {
    console.log(`[Provider] 🌐 Creating WebSocket: ${trimmed.slice(0, 50)}...`);
    return new ethers.WebSocketProvider(trimmed);
  } else if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    console.log(`[Provider] 🌐 Creating HTTP: ${trimmed.slice(0, 50)}...`);
    return new ethers.JsonRpcProvider(trimmed);
  } else {
    throw new Error(`Invalid RPC URL: ${trimmed}`);
  }
}

/**
 * Tạo providers từ RPC_URLS string
 * @param {string} rpcUrlsString - Comma-separated URLs
 * @returns {{ primary: Provider, fallbacks: Provider[], hasWSS: boolean }}
 */
export function createProviders(rpcUrlsString) {
  const urls = rpcUrlsString.split(',').map(s => s.trim()).filter(Boolean);
  
  if (urls.length === 0) {
    throw new Error('No RPC URLs provided');
  }

  // Separate WSS and HTTP
  const wssUrls = urls.filter(u => u.startsWith('wss://') || u.startsWith('ws://'));
  const httpUrls = urls.filter(u => u.startsWith('https://') || u.startsWith('http://'));

  let primary, fallbacks = [];
  let hasWSS = false;

  // ✅ FIX: Ưu tiên WSS làm primary
  if (wssUrls.length > 0) {
    console.log(`[Provider] ✅ Found ${wssUrls.length} WebSocket RPC(s)`);
    primary = makeProvider(wssUrls[0]);
    hasWSS = true;
    
    // Remaining WSS + HTTP as fallbacks
    fallbacks = [...wssUrls.slice(1), ...httpUrls].map(makeProvider);
  } else if (httpUrls.length > 0) {
    console.warn(`[Provider] ⚠️  No WebSocket RPC - Mempool sniping will NOT work!`);
    console.warn(`[Provider] 💡 Get free WSS from: https://www.alchemy.com/`);
    primary = makeProvider(httpUrls[0]);
    fallbacks = httpUrls.slice(1).map(makeProvider);
  } else {
    throw new Error('No valid RPC URLs found');
  }

  console.log(`[Provider] 📊 Primary: ${primary.constructor.name}`);
  console.log(`[Provider] 📊 Fallbacks: ${fallbacks.length}`);

  return { primary, fallbacks, hasWSS };
}

/**
 * Validate provider connection
 */
export async function validateProvider(provider, name = 'Provider') {
  try {
    console.log(`[${name}] 🔍 Testing connection...`);
    
    const [network, blockNumber] = await Promise.all([
      provider.getNetwork(),
      provider.getBlockNumber()
    ]);

    if (network.chainId !== 1n) {
      throw new Error(`Wrong network: ${network.name} (chainId: ${network.chainId}), expected Ethereum Mainnet`);
    }

    console.log(`[${name}] ✅ Connected - Block: ${blockNumber}`);
    return true;
  } catch (e) {
    console.error(`[${name}] ❌ Connection failed:`, e.message);
    return false;
  }
}

/**
 * Create provider with auto-retry fallback
 */
export async function createRobustProvider(rpcUrlsString) {
  const { primary, fallbacks, hasWSS } = createProviders(rpcUrlsString);

  // Test primary
  const primaryOk = await validateProvider(primary, 'Primary');
  
  if (primaryOk) {
    if (!hasWSS) {
      console.warn(`[Provider] ⚠️  WARNING: No WebSocket - Bot will use fallback mode`);
      console.warn(`[Provider] 💡 For best performance, add WSS to RPC_URLS:`);
      console.warn(`[Provider]    RPC_URLS=wss://YOUR_KEY,https://...`);
    }
    return { provider: primary, hasWSS };
  }

  // Try fallbacks
  console.warn(`[Provider] ⚠️  Primary failed, trying fallbacks...`);
  
  for (let i = 0; i < fallbacks.length; i++) {
    const fb = fallbacks[i];
    const fbOk = await validateProvider(fb, `Fallback #${i + 1}`);
    
    if (fbOk) {
      console.log(`[Provider] ✅ Using Fallback #${i + 1}`);
      return { 
        provider: fb, 
        hasWSS: fb instanceof ethers.WebSocketProvider 
      };
    }
  }

  throw new Error('All RPC providers failed!');
}