#!/usr/bin/env node

/**
 * 🧪 SETUP CHECKER (Signal + Banana Gun)
 * Kiểm tra cấu hình cần thiết để chạy mempool scanner và (tùy chọn) auto-buy qua Banana Gun.
 *
 * Chạy: node test_setup.js
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import TelegramBot from 'node-telegram-bot-api';

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m'
};

function log(emoji, color, message) {
  console.log(`${color}${emoji} ${message}${COLORS.reset}`);
}

function success(msg) { log('✅', COLORS.green, msg); }
function error(msg) { log('❌', COLORS.red, msg); }
function warn(msg) { log('⚠️ ', COLORS.yellow, msg); }
function info(msg) { log('ℹ️ ', COLORS.blue, msg); }
function title(msg) {
  console.log(`\n${COLORS.magenta}${'═'.repeat(50)}`);
  console.log(`🎯 ${msg}`);
  console.log(`${'═'.repeat(50)}${COLORS.reset}\n`);
}

function toNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return Number(fallback);
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

async function testEnvVariables() {
  title('KIỂM TRA FILE .ENV');

  let allOk = true;

  const rpcValue = process.env.RPC_URLS;
  if (!rpcValue) {
    error('RPC_URLS thiếu trong .env');
    allOk = false;
  } else {
    if (!rpcValue.includes('wss://')) {
      warn('RPC_URLS không có WebSocket (wss://) - scanner sẽ chạy ở chế độ fallback chậm hơn');
    } else {
      success(`RPC_URLS: ${rpcValue.slice(0, 40)}...`);
    }
  }

  const minLp = toNumber(process.env.MIN_LP_ETH, '0.5');
  const maxLp = toNumber(process.env.MAX_LP_ETH, '1');

  if (Number.isNaN(minLp) || minLp <= 0) {
    error('MIN_LP_ETH phải là số > 0');
    allOk = false;
  } else {
    success(`MIN_LP_ETH: ${minLp}`);
  }

  if (Number.isNaN(maxLp) || maxLp <= 0) {
    error('MAX_LP_ETH phải là số > 0');
    allOk = false;
  } else {
    success(`MAX_LP_ETH: ${maxLp}`);
  }

  if (allOk && minLp > maxLp) {
    error('MIN_LP_ETH không thể lớn hơn MAX_LP_ETH');
    allOk = false;
  }

  const taxMax = toNumber(process.env.STRICT_TAX_BPS_MAX, '0');
  if (Number.isNaN(taxMax) || taxMax < 0) {
    error('STRICT_TAX_BPS_MAX phải là số >= 0');
    allOk = false;
  } else {
    success(`STRICT_TAX_BPS_MAX: ${taxMax}`);
  }

  const selectors = process.env.BLOCKLIST_SELECTORS;
  if (selectors) {
    info(`BLOCKLIST_SELECTORS: ${selectors}`);
  } else {
    warn('BLOCKLIST_SELECTORS chưa thiết lập - đang dùng default trong code');
  }

  const timeoutMinutes = toNumber(process.env.AUTO_SELL_TIMEOUT_MINUTES, '10');
  if (Number.isNaN(timeoutMinutes) || timeoutMinutes <= 0) {
    error('AUTO_SELL_TIMEOUT_MINUTES phải là số > 0');
    allOk = false;
  } else {
    success(`AUTO_SELL_TIMEOUT_MINUTES: ${timeoutMinutes} phút`);
  }

  const rugThresholdBps = toNumber(process.env.RUG_PULL_THRESHOLD_BPS, '500');
  if (Number.isNaN(rugThresholdBps) || rugThresholdBps <= 0) {
    error('RUG_PULL_THRESHOLD_BPS phải là số > 0');
    allOk = false;
  } else {
    success(`RUG_PULL_THRESHOLD_BPS: ${rugThresholdBps} BPS`);
  }

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
  const telegramChat = process.env.TELEGRAM_CHAT_ID;

  if (telegramToken && telegramChat) {
    info('Telegram: Token và Chat ID đã thiết lập');
  } else if (telegramToken || telegramChat) {
    warn('Telegram config chưa đầy đủ (cần cả token và chat id)');
  } else {
    warn('Telegram chưa cấu hình - sẽ không có thông báo (có thể bổ sung sau)');
  }

  return allOk;
}

async function testBananaGun() {
  title('KIỂM TRA BANANA GUN AUTO-TRADE (TÙY CHỌN)');

  const {
    BANANA_GUN_TG_API_ID: apiId,
    BANANA_GUN_TG_API_HASH: apiHash,
    BANANA_GUN_TG_SESSION: session,
    BANANA_GUN_BUY_AMOUNT_ETH: amountEth,
    BANANA_GUN_SLIPPAGE_BPS: slippageBps,
    BANANA_GUN_PRIORITY_FEE_GWEI: priorityFeeGwei,
    BANANA_GUN_GAS_MULTIPLIER: gasMultiplier,
    BANANA_GUN_SELL_PERCENT: sellPercent,
    BANANA_GUN_TG_BOT: botUsername,
    BANANA_GUN_TG_BUY_TEMPLATE: buyTemplate,
    BANANA_GUN_TG_SELL_TEMPLATE: sellTemplate,
    BANANA_GUN_WALLET_ADDRESS: walletAddress,
    BANANA_GUN_TG_RESPONSE_TIMEOUT_MS: responseTimeout
  } = process.env;

  const provided = [apiId, apiHash, session, amountEth].filter(Boolean).length;
  const optionalValues = [slippageBps, priorityFeeGwei, gasMultiplier, sellPercent, botUsername, buyTemplate, sellTemplate, walletAddress, responseTimeout];

  if (provided === 0 && optionalValues.every(v => !v)) {
    warn('Bỏ qua Banana Gun (chưa cấu hình)');
    return null;
  }

  let ok = true;

  if (!apiId || !apiHash || !session || !amountEth) {
    warn('Cần đủ BANANA_GUN_TG_API_ID, BANANA_GUN_TG_API_HASH, BANANA_GUN_TG_SESSION, BANANA_GUN_BUY_AMOUNT_ETH để bật auto-buy.');
    ok = false;
  }

  if (apiId) {
    const value = Number(apiId);
    if (!Number.isInteger(value) || value <= 0) {
      error('BANANA_GUN_TG_API_ID phải là số nguyên dương');
      ok = false;
    } else {
      success(`BANANA_GUN_TG_API_ID: ${value}`);
    }
  }

  if (apiHash) {
    if (apiHash.length < 16) {
      warn('BANANA_GUN_TG_API_HASH trông hơi ngắn, vui lòng kiểm tra lại');
    } else {
      success(`BANANA_GUN_TG_API_HASH: ${apiHash.slice(0, 4)}***${apiHash.slice(-4)}`);
    }
  }

  if (session) {
    if (session.length < 10) {
      error('BANANA_GUN_TG_SESSION quá ngắn, có thể chưa copy đúng StringSession');
      ok = false;
    } else {
      success(`BANANA_GUN_TG_SESSION: ${session.slice(0, 6)}***${session.slice(-6)}`);
    }
  }

  if (amountEth) {
    try {
      const wei = ethers.parseEther(amountEth);
      if (wei <= 0n) {
        throw new Error('Amount phải > 0');
      }
      success(`BANANA_GUN_BUY_AMOUNT_ETH: ${amountEth} ETH (${wei} wei)`);
    } catch (e) {
      error(`BANANA_GUN_BUY_AMOUNT_ETH lỗi: ${e.message}`);
      ok = false;
    }
  }

  if (slippageBps) {
    const value = toNumber(slippageBps, '0');
    if (!Number.isFinite(value) || value <= 0) {
      error('BANANA_GUN_SLIPPAGE_BPS phải là số > 0');
      ok = false;
    } else {
      success(`BANANA_GUN_SLIPPAGE_BPS: ${value}`);
    }
  }

  if (priorityFeeGwei) {
    const value = toNumber(priorityFeeGwei, '0');
    if (!Number.isFinite(value) || value < 0) {
      error('BANANA_GUN_PRIORITY_FEE_GWEI phải là số ≥ 0');
      ok = false;
    } else {
      success(`BANANA_GUN_PRIORITY_FEE_GWEI: ${value}`);
    }
  }

  if (gasMultiplier) {
    const value = toNumber(gasMultiplier, '0');
    if (!Number.isFinite(value) || value <= 0) {
      error('BANANA_GUN_GAS_MULTIPLIER phải là số > 0');
      ok = false;
    } else {
      success(`BANANA_GUN_GAS_MULTIPLIER: ${value}`);
    }
  }

  if (sellPercent) {
    const value = toNumber(sellPercent, '0');
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      error('BANANA_GUN_SELL_PERCENT phải nằm trong khoảng 1-100');
      ok = false;
    } else {
      success(`BANANA_GUN_SELL_PERCENT: ${value}%`);
    }
  }

  if (botUsername) {
    info(`BANANA_GUN_TG_BOT: ${botUsername}`);
  }

  if (buyTemplate) {
    if (!buyTemplate.includes('{token}')) {
      warn('BANANA_GUN_TG_BUY_TEMPLATE nên chứa {token} để thay thế địa chỉ token');
    } else {
      success('BANANA_GUN_TG_BUY_TEMPLATE: OK');
    }
  }

  if (sellTemplate) {
    if (!sellTemplate.includes('{token}')) {
      warn('BANANA_GUN_TG_SELL_TEMPLATE nên chứa {token}');
    } else {
      success('BANANA_GUN_TG_SELL_TEMPLATE: OK');
    }
  }

  if (walletAddress) {
    if (!ethers.isAddress(walletAddress)) {
      warn('BANANA_GUN_WALLET_ADDRESS không phải địa chỉ hợp lệ (tùy chọn nhưng nên đúng)');
    } else {
      success(`BANANA_GUN_WALLET_ADDRESS: ${walletAddress}`);
    }
  }

  if (responseTimeout) {
    const value = toNumber(responseTimeout, '0');
    if (!Number.isFinite(value) || value <= 0) {
      warn('BANANA_GUN_TG_RESPONSE_TIMEOUT_MS phải là số > 0 (sẽ dùng mặc định 20000)');
    } else {
      info(`BANANA_GUN_TG_RESPONSE_TIMEOUT_MS: ${value} ms`);
    }
  }

  return ok;
}

async function testRpcConnection() {
  title('KIỂM TRA KẾT NỐI RPC');

  const urls = process.env.RPC_URLS?.split(',').map(s => s.trim()).filter(Boolean) || [];

  if (urls.length === 0) {
    error('Không có RPC URL nào');
    return false;
  }

  let hasWSS = false;
  let httpCount = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const isWSS = url.startsWith('wss://') || url.startsWith('ws://');
    const isHTTP = url.startsWith('https://') || url.startsWith('http://');

    try {
      info(`Đang test RPC #${i + 1}: ${url.slice(0, 70)}...`);

      const provider = isWSS
        ? new ethers.WebSocketProvider(url)
        : new ethers.JsonRpcProvider(url);

      const blockNumber = await Promise.race([
        provider.getBlockNumber(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
      ]);

      const network = await provider.getNetwork();

      if (network.chainId !== 1n) {
        error(`RPC #${i + 1}: Không phải Ethereum Mainnet (chainId: ${network.chainId})`);
        return false;
      }

      success(`RPC #${i + 1}: OK - Block ${blockNumber} (${isWSS ? 'WebSocket' : 'HTTP'})`);

      if (isWSS) hasWSS = true;
      if (isHTTP) httpCount++;

      if (isWSS && provider.destroy) {
        provider.destroy();
      }
    } catch (e) {
      error(`RPC #${i + 1}: FAIL - ${e.message}`);
      return false;
    }
  }

  if (!hasWSS) {
    warn('Không có WebSocket RPC - scanner sẽ chậm hơn và bỏ lỡ mempool realtime');
  }

  if (httpCount === 0) {
    warn('Không có HTTP RPC fallback - nên có ít nhất 1 HTTP RPC');
  }

  success(`Tổng: ${urls.length} RPC (${hasWSS ? '✓' : '✗'} WebSocket, ${httpCount} HTTP)`);
  return true;
}

async function testTelegram() {
  title('KIỂM TRA TELEGRAM BOT (TÙY CHỌN)');

  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token && !chatId) {
    warn('Bỏ qua kiểm tra Telegram (chưa cấu hình)');
    return null;
  }

  if (!token || !chatId) {
    error('Cần cả TELEGRAM_BOT_TOKEN và TELEGRAM_CHAT_ID để kiểm tra Telegram');
    return false;
  }

  try {
    info(`Token: ${token.slice(0, 25)}...`);
    info(`Chat ID: ${chatId}`);

    const bot = new TelegramBot(token, { polling: false });
    const testMsg = `🧪 TEST MESSAGE\n━━━━━━━━━━━━━━━━\n⏰ ${new Date().toLocaleString('vi-VN')}\n✅ Scanner setup đang được kiểm tra`; 

    await bot.sendMessage(chatId, testMsg, {
      disable_web_page_preview: true
    });

    success('Test message đã gửi - kiểm tra Telegram của bạn!');

    const me = await bot.getMe();
    info(`Bot username: @${me.username}`);
    info(`Bot name: ${me.first_name}`);

    return true;
  } catch (e) {
    error(`Lỗi Telegram: ${e.message}`);

    if (e.message.includes('401')) {
      error('Token không hợp lệ - lấy token mới từ @BotFather');
    } else if (e.message.includes('400')) {
      error('Chat ID không hợp lệ hoặc chưa /start bot');
    }

    return false;
  }
}

async function testContracts() {
  title('KIỂM TRA CONTRACT ADDRESSES');

  const contracts = {
    WETH: process.env.WETH || '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    ROUTER_V2: process.env.ROUTER_V2 || '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    FACTORY_V2: process.env.FACTORY_V2 || '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'
  };

  try {
    const urls = process.env.RPC_URLS?.split(',').map(s => s.trim()).filter(Boolean) || [];
    const httpRpc = urls.find(u => u.startsWith('http'));

    if (!httpRpc) {
      warn('Không có HTTP RPC để test contracts - bỏ qua bước này');
      return true;
    }

    const provider = new ethers.JsonRpcProvider(httpRpc);

    for (const [name, address] of Object.entries(contracts)) {
      info(`Checking ${name}: ${address}`);

      const code = await provider.getCode(address);

      if (code === '0x' || code === '0x0') {
        error(`${name} không phải là contract!`);
        return false;
      } else {
        success(`${name}: OK (${code.length} bytes)`);
      }
    }

    return true;
  } catch (e) {
    error(`Lỗi khi test contracts: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log(`
${COLORS.magenta}
╔════════════════════════════════════════════════════╗
║                                                    ║
║    🧪 ETH MEMPOOL SCANNER - SIGNAL SETUP CHECK     ║
║                                                    ║
║  Đảm bảo cấu hình chuẩn trước khi chạy scanner    ║
║                                                    ║
╚════════════════════════════════════════════════════╝
${COLORS.reset}`);

  const results = {
    env: false,
    rpc: false,
    telegram: null,
    contracts: false,
    bananaGun: null
  };

  try {
    results.env = await testEnvVariables();
    if (!results.env) {
      error('\n⛔ .env file có vấn đề - sửa trước khi tiếp tục!\n');
      process.exit(1);
    }

    results.rpc = await testRpcConnection();
    if (!results.rpc) {
      error('\n⛔ RPC connection failed - kiểm tra lại RPC URLs!\n');
      process.exit(1);
    }

    results.telegram = await testTelegram();
    if (results.telegram === false) {
      warn('\n⚠️  Telegram chưa sẵn sàng - scanner vẫn chạy được nhưng không có thông báo!\n');
    }

    results.bananaGun = await testBananaGun();
    if (results.bananaGun === false) {
      warn('\n⚠️  Banana Gun cấu hình chưa hợp lệ - auto-buy sẽ không hoạt động!\n');
    }

    results.contracts = await testContracts();
    if (!results.contracts) {
      error('\n⛔ Contract addresses sai - kiểm tra lại WETH/ROUTER/FACTORY!\n');
      process.exit(1);
    }

    title('KẾT QUẢ TỔNG HỢP');

    const checks = [
      { name: 'Environment Variables', result: results.env, critical: true },
      { name: 'RPC Connection', result: results.rpc, critical: true },
      { name: 'Contract Addresses', result: results.contracts, critical: true },
      { name: 'Telegram Bot', result: results.telegram, critical: false },
      { name: 'Banana Gun Auto-Buy', result: results.bananaGun, critical: false }
    ];

    let criticalFailed = false;
    let warningCount = 0;

    for (const check of checks) {
      if (check.result === true) {
        success(`${check.name}: PASS`);
      } else if (check.result === null) {
        warn(`${check.name}: SKIPPED`);
        warningCount++;
      } else if (check.result === false) {
        if (check.critical) {
          error(`${check.name}: FAIL (CRITICAL)`);
          criticalFailed = true;
        } else {
          warn(`${check.name}: WARNING`);
          warningCount++;
        }
      }
    }

    console.log(`\n${'═'.repeat(50)}\n`);

    if (criticalFailed) {
      error('❌ SETUP CHƯA HOÀN THÀNH - sửa lỗi critical trước!');
      process.exit(1);
    }

    if (warningCount > 0) {
      warn(`⚠️  SETUP OK nhưng có ${warningCount} cảnh báo cần lưu ý.`);
    } else {
      success('🎉 SETUP HOÀN THÀNH - SẴN SÀNG CHẠY SCANNER!');
    }

    console.log('\n👉 Bước tiếp theo: npm run auto:mempool');

  } catch (e) {
    console.error('\n💥 Fatal error trong setup checker:', e);
    process.exit(1);
  }
}

main();
