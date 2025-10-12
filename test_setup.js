#!/usr/bin/env node

/**
 * 🧪 TEST SETUP SCRIPT
 * Kiểm tra toàn bộ cấu hình trước khi chạy bot
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

async function testEnvVariables() {
  title('KIỂM TRA FILE .ENV');
  
  const required = {
    'RPC_URLS': process.env.RPC_URLS,
    'PRIVATE_KEY': process.env.PRIVATE_KEY,
    'WALLET_ADDRESS': process.env.WALLET_ADDRESS,
    'TELEGRAM_TOKEN': process.env.TELEGRAM_TOKEN,
    'TELEGRAM_CHAT_ID': process.env.TELEGRAM_CHAT_ID
  };

  let allOk = true;
  
  for (const [key, value] of Object.entries(required)) {
    if (!value) {
      error(`${key} thiếu trong .env`);
      allOk = false;
    } else {
      // Kiểm tra format
      if (key === 'PRIVATE_KEY' && !value.startsWith('0x')) {
        error(`${key} phải bắt đầu bằng 0x`);
        allOk = false;
      } else if (key === 'WALLET_ADDRESS' && !value.startsWith('0x')) {
        error(`${key} phải bắt đầu bằng 0x`);
        allOk = false;
      } else if (key === 'RPC_URLS' && !value.includes('wss://')) {
        warn(`${key} không có WebSocket (wss://) - Mempool sniping sẽ KHÔNG hoạt động!`);
        allOk = false;
      } else {
        success(`${key}: ${value.slice(0, 20)}...`);
      }
    }
  }

  // Check optional
  const optional = ['BUY_ETH', 'MIN_LP_ETH', 'MAX_LP_ETH', 'TP_PCT'];
  for (const key of optional) {
    if (process.env[key]) {
      info(`${key}: ${process.env[key]}`);
    } else {
      warn(`${key} chưa set, sẽ dùng default`);
    }
  }

  return allOk;
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
      info(`Đang test RPC #${i + 1}: ${url.slice(0, 50)}...`);
      
      const provider = isWSS 
        ? new ethers.WebSocketProvider(url)
        : new ethers.JsonRpcProvider(url);

      const blockNumber = await Promise.race([
        provider.getBlockNumber(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
      ]);

      const network = await provider.getNetwork();
      
      if (network.chainId !== 1n) {
        error(`❌ RPC #${i + 1}: Không phải Ethereum Mainnet (chainId: ${network.chainId})`);
        return false;
      }

      success(`RPC #${i + 1}: OK - Block ${blockNumber} (${isWSS ? 'WebSocket' : 'HTTP'})`);
      
      if (isWSS) hasWSS = true;
      if (isHTTP) httpCount++;

      // Cleanup WSS
      if (isWSS && provider.destroy) {
        provider.destroy();
      }

    } catch (e) {
      error(`RPC #${i + 1}: FAIL - ${e.message}`);
      return false;
    }
  }

  if (!hasWSS) {
    error('KHÔNG CÓ WEBSOCKET RPC - Bot sẽ không thể snipe mempool!');
    return false;
  }

  if (httpCount === 0) {
    warn('Không có HTTP RPC fallback - Nên có ít nhất 1 HTTP RPC');
  }

  success(`Tổng: ${urls.length} RPC (${hasWSS ? '✓' : '✗'} WebSocket, ${httpCount} HTTP)`);
  return true;
}

async function testWallet() {
  title('KIỂM TRA WALLET');

  try {
    const privateKey = process.env.PRIVATE_KEY;
    const expectedAddress = process.env.WALLET_ADDRESS;

    if (!privateKey || !expectedAddress) {
      error('Private key hoặc wallet address thiếu');
      return false;
    }

    // Check private key format
    if (privateKey.length !== 66) {
      error(`Private key length sai: ${privateKey.length} (phải là 66)`);
      return false;
    }

    // Create wallet from private key
    const wallet = new ethers.Wallet(privateKey);
    
    if (wallet.address.toLowerCase() !== expectedAddress.toLowerCase()) {
      error(`Address không khớp!`);
      error(`  From private key: ${wallet.address}`);
      error(`  In .env: ${expectedAddress}`);
      return false;
    }

    success(`Address khớp: ${wallet.address}`);

    // Check balance
    const urls = process.env.RPC_URLS?.split(',').map(s => s.trim()).filter(Boolean) || [];
    const httpRpc = urls.find(u => u.startsWith('http'));
    
    if (!httpRpc) {
      warn('Không có HTTP RPC để check balance');
      return true;
    }

    const provider = new ethers.JsonRpcProvider(httpRpc);
    const balance = await provider.getBalance(wallet.address);
    const balanceETH = ethers.formatEther(balance);

    if (balance === 0n) {
      error(`Balance: 0 ETH - Cần nạp ETH để trade!`);
      return false;
    } else if (balance < ethers.parseEther('0.05')) {
      warn(`Balance: ${balanceETH} ETH - Nên có ít nhất 0.05 ETH`);
    } else {
      success(`Balance: ${balanceETH} ETH ✓`);
    }

    // Check nonce
    const nonce = await provider.getTransactionCount(wallet.address);
    info(`Nonce: ${nonce} ${nonce === 0 ? '(wallet mới)' : ''}`);

    return true;

  } catch (e) {
    error(`Lỗi khi test wallet: ${e.message}`);
    return false;
  }
}

async function testTelegram() {
  title('KIỂM TRA TELEGRAM BOT');

  try {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      error('Telegram token hoặc chat ID thiếu');
      return false;
    }

    info(`Token: ${token.slice(0, 20)}...`);
    info(`Chat ID: ${chatId}`);

    const bot = new TelegramBot(token, { polling: false });

    // Test send message
    info('Đang gửi test message...');
    
    const testMsg = `🧪 TEST MESSAGE
━━━━━━━━━━━━━━━━
⏰ ${new Date().toLocaleString('vi-VN')}
✅ Bot setup đang được kiểm tra
📝 Nếu nhận được tin này = Telegram OK!`;

    await bot.sendMessage(chatId, testMsg, { 
      disable_web_page_preview: true 
    });

    success('Test message đã gửi - Kiểm tra Telegram của bạn!');
    
    // Test bot info
    const me = await bot.getMe();
    info(`Bot username: @${me.username}`);
    info(`Bot name: ${me.first_name}`);

    return true;

  } catch (e) {
    error(`Lỗi Telegram: ${e.message}`);
    
    if (e.message.includes('401')) {
      error('Token không hợp lệ - Lấy token mới từ @BotFather');
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
      warn('Không có HTTP RPC để test contracts');
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

async function testTradingSettings() {
  title('KIỂM TRA TRADING SETTINGS');

  const settings = {
    BUY_ETH: process.env.BUY_ETH || '0.01',
    MIN_LP_ETH: process.env.MIN_LP_ETH || '0.5',
    MAX_LP_ETH: process.env.MAX_LP_ETH || '1.0',
    STRICT_TAX_BPS_MAX: process.env.STRICT_TAX_BPS_MAX || '0',
    TP_PCT: process.env.TP_PCT || '20',
    TP_TIMEOUT_SEC: process.env.TP_TIMEOUT_SEC || '600',
    PRICE_MULTIPLE_ABORT: process.env.PRICE_MULTIPLE_ABORT || '3',
    RUG_DEFENSE: process.env.RUG_DEFENSE || '1',
    RUG_THRESHOLD_BP: process.env.RUG_THRESHOLD_BP || '2000'
  };

  let allOk = true;

  for (const [key, value] of Object.entries(settings)) {
    const numValue = Number(value);
    
    if (isNaN(numValue)) {
      error(`${key} = ${value} không phải là số`);
      allOk = false;
      continue;
    }

    let status = '✓';
    let color = COLORS.green;

    // Warnings cho settings không tối ưu
    if (key === 'BUY_ETH' && numValue > 0.1) {
      status = '⚠️  Cao - Nên start với <0.05 ETH';
      color = COLORS.yellow;
    } else if (key === 'MIN_LP_ETH' && numValue < 0.3) {
      status = '⚠️  Thấp - Dễ match scam';
      color = COLORS.yellow;
    } else if (key === 'STRICT_TAX_BPS_MAX' && numValue > 0) {
      status = '⚠️  Cho phép tax - Rủi ro cao';
      color = COLORS.yellow;
    } else if (key === 'TP_PCT' && numValue < 10) {
      status = '⚠️  TP thấp - Nhiều gas phí';
      color = COLORS.yellow;
    } else if (key === 'TP_TIMEOUT_SEC' && numValue > 1800) {
      status = '⚠️  Timeout dài - Hold lâu';
      color = COLORS.yellow;
    }

    console.log(`${color}  ${key}: ${value} ${status}${COLORS.reset}`);
  }

  // Calculate expected costs
  const buyETH = Number(settings.BUY_ETH);
  const estimatedGas = 0.002; // ~0.002 ETH per trade
  const tradesPerBalance = Math.floor(buyETH / (buyETH + estimatedGas));
  
  info(`\nDự kiến: Mỗi trade tốn ~${buyETH + estimatedGas} ETH (buy + gas)`);
  
  return allOk;
}

async function main() {
  console.log(`
${COLORS.magenta}
╔════════════════════════════════════════════════════╗
║                                                    ║
║        🧪 ETH SNIPER BOT - SETUP TEST             ║
║                                                    ║
║  Kiểm tra toàn bộ cấu hình trước khi chạy         ║
║                                                    ║
╚════════════════════════════════════════════════════╝
${COLORS.reset}
`);

  const results = {
    env: false,
    rpc: false,
    wallet: false,
    telegram: false,
    contracts: false,
    settings: false
  };

  try {
    // Test 1: Environment variables
    results.env = await testEnvVariables();
    if (!results.env) {
      error('\n⛔ .env file có vấn đề - Sửa trước khi tiếp tục!\n');
      process.exit(1);
    }

    // Test 2: RPC connections
    results.rpc = await testRpcConnection();
    if (!results.rpc) {
      error('\n⛔ RPC connection failed - Kiểm tra lại RPC URLs!\n');
      process.exit(1);
    }

    // Test 3: Wallet
    results.wallet = await testWallet();
    if (!results.wallet) {
      error('\n⛔ Wallet có vấn đề - Kiểm tra private key và balance!\n');
      process.exit(1);
    }

    // Test 4: Telegram
    results.telegram = await testTelegram();
    if (!results.telegram) {
      warn('\n⚠️  Telegram có vấn đề - Bot vẫn chạy được nhưng không có notification!\n');
    }

    // Test 5: Contracts
    results.contracts = await testContracts();
    if (!results.contracts) {
      error('\n⛔ Contract addresses sai - Sửa WETH/ROUTER/FACTORY!\n');
      process.exit(1);
    }

    // Test 6: Trading settings
    results.settings = await testTradingSettings();

    // Final summary
    title('KẾT QUẢ TỔNG HỢP');

    const checks = [
      { name: 'Environment Variables', result: results.env, critical: true },
      { name: 'RPC Connection', result: results.rpc, critical: true },
      { name: 'Wallet Setup', result: results.wallet, critical: true },
      { name: 'Telegram Bot', result: results.telegram, critical: false },
      { name: 'Contract Addresses', result: results.contracts, critical: true },
      { name: 'Trading Settings', result: results.settings, critical: false }
    ];

    let criticalFailed = false;
    let warningCount = 0;

    console.log('');
    for (const check of checks) {
      if (check.result) {
        success(`${check.name}: PASS`);
      } else if (check.critical) {
        error(`${check.name}: FAIL (CRITICAL)`);
        criticalFailed = true;
      } else {
        warn(`${check.name}: WARNING`);
        warningCount++;
      }
    }

    console.log('');
    console.log(`${'═'.repeat(50)}\n`);

    if (criticalFailed) {
      error('❌ SETUP CHƯA HOÀN THÀNH - Sửa các lỗi critical trước!');
      console.log('\n💡 Hướng dẫn:');
      console.log('   1. Đọc kỹ error messages phía trên');
      console.log('   2. Sửa file .env theo hướng dẫn');
      console.log('   3. Chạy lại: node test_setup.js\n');
      process.exit(1);
    } else if (warningCount > 0) {
      warn(`⚠️  SETUP OK NHƯNG CÓ ${warningCount} WARNING`);
      console.log('\n💡 Khuyến nghị:');
      console.log('   - Sửa các warnings để bot hoạt động tốt nhất');
      console.log('   - Hoặc tiếp tục nếu bạn hiểu rủi ro\n');
      
      // Ask user to confirm
      console.log('🚀 Bạn có muốn tiếp tục chạy bot không?');
      console.log('   - Nếu YES: npm run auto:mempool');
      console.log('   - Nếu NO: Sửa warnings và test lại\n');
    } else {
      success('🎉 SETUP HOÀN THÀNH - SẴN SÀNG CHẠY BOT!');
      console.log('\n🚀 Để chạy bot:');
      console.log(`   ${COLORS.green}npm run auto:mempool${COLORS.reset}`);
      console.log('\n📊 Để theo dõi:');
      console.log('   - Xem logs trong console');
      console.log('   - Nhận notifications qua Telegram');
      console.log('   - Kiểm tra transactions trên Etherscan\n');
      console.log('💡 Tips:');
      console.log('   - Start với amount nhỏ (0.01 ETH)');
      console.log('   - Theo dõi chặt 30 phút đầu');
      console.log('   - Điều chỉnh settings dựa trên kết quả\n');
      console.log('⚠️  Remember:');
      console.log('   - Crypto trading có rủi ro');
      console.log('   - Chỉ trade với tiền dư');
      console.log('   - Luôn backup private key an toàn\n');
    }

    // Summary table
    console.log('📋 Quick Settings Summary:');
    console.log('┌─────────────────────────┬──────────────────────┐');
    console.log(`│ Buy Amount              │ ${(process.env.BUY_ETH || '0.01').padEnd(20)} │`);
    console.log(`│ LP Range                │ ${(process.env.MIN_LP_ETH || '0.5')}-${(process.env.MAX_LP_ETH || '1.0')} ETH`.padEnd(20) + '        │');
    console.log(`│ Max Tax                 │ ${(process.env.STRICT_TAX_BPS_MAX || '0')} BPS`.padEnd(20) + '             │');
    console.log(`│ Take Profit             │ ${(process.env.TP_PCT || '20')}%`.padEnd(20) + '                │');
    console.log(`│ Timeout                 │ ${(process.env.TP_TIMEOUT_SEC || '600')}s`.padEnd(20) + '               │');
    console.log(`│ Price Guard             │ ${(process.env.PRICE_MULTIPLE_ABORT || '3')}x`.padEnd(20) + '                │');
    console.log(`│ Rug Defense             │ ${(process.env.RUG_DEFENSE || '1') === '1' ? 'ON' : 'OFF'}`.padEnd(20) + '                │');
    console.log('└─────────────────────────┴──────────────────────┘\n');

  } catch (e) {
    error(`\n💥 Lỗi không mong muốn: ${e.message}`);
    console.error(e);
    process.exit(1);
  }
}

// Run tests
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});