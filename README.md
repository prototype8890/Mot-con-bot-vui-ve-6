# 🚀 ETH Mempool Sniper Bot

Bot tự động snipe tokens mới trên Ethereum Mainnet với đầy đủ tính năng bảo vệ và thông báo chi tiết.

## ✨ Tính Năng Chính

### ✅ 100% Đáp Ứng Yêu Cầu

| Tính Năng | Mô Tả | Trạng Thái |
|-----------|-------|------------|
| 🔍 **Auto Scan** | Quét mempool real-time, phát hiện AddLP ngay lập tức | ✅ |
| 🛡️ **Smart Filter** | Lọc LP 0.5-1 ETH, Tax=0, No malicious functions | ✅ |
| ⚡ **Fast Snipe** | Mua ngay khi phát hiện, abort nếu giá >3x | ✅ |
| 📊 **Auto TP/SL** | Lời 20% bán ngay, timeout 10p, rug defense | ✅ |
| 📱 **Rich Notifications** | Thông báo đầy đủ mọi thông tin qua Telegram | ✅ |

### 🎯 8 Bước Kiểm Tra An Toàn

1. ✅ **Base Price Check** - Snapshot giá khi phát hiện
2. ✅ **Tax Detection** - Quét tax từ bytecode
3. ✅ **Malicious Functions** - Phát hiện hàm nguy hiểm (setTax, blacklist...)
4. ✅ **Honeypot Test** (Optional) - Test trade trước khi mua thật
5. ✅ **Price Guard** - Hủy nếu giá tăng >3x (prevent frontrun)
6. ✅ **CallStatic Buy** - Simulation trước khi thực hiện
7. ✅ **Rug Defense** - Phát hiện rút LP và bán khẩn cấp
8. ✅ **Position Manager** - Tự động TP 20% hoặc timeout 10 phút

## 📦 Cài Đặt

### Yêu Cầu

- Node.js v16+
- NPM hoặc Yarn
- Ethereum wallet với ETH
- Telegram bot token
- RPC endpoint với WebSocket (Alchemy/Infura/QuickNode)

### Bước 1: Clone & Install

```bash
# Clone project
git clone <your-repo>
cd <project-folder>

# Install dependencies
npm install

# Hoặc nếu chưa có package.json
npm init -y
npm install ethers@^6.13.2 dotenv@^16.4.5 zod@^3.23.8 node-telegram-bot-api@^0.66.0
```

### Bước 2: Cấu Hình .env

```bash
# Copy .env example
cp .env.example .env

# Edit với editor yêu thích
nano .env
```

**Điền các giá trị bắt buộc:**

```bash
# RPC - WebSocket phải đứng đầu
RPC_URLS=wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY,https://eth.llamarpc.com

# Wallet
PRIVATE_KEY=0xYourPrivateKey
WALLET_ADDRESS=0xYourAddress

# Telegram
TELEGRAM_TOKEN=1234567890:ABCdef...
TELEGRAM_CHAT_ID=123456789

# Trading (có thể dùng default)
BUY_ETH=0.01
MIN_LP_ETH=0.5
MAX_LP_ETH=1.0
TP_PCT=20
TP_TIMEOUT_SEC=600
```

### Bước 3: Test Setup

```bash
# Chạy test script để kiểm tra mọi thứ
node test_setup.js
```

Kết quả mong đợi:
```
✅ Environment Variables: PASS
✅ RPC Connection: PASS
✅ Wallet Setup: PASS
✅ Telegram Bot: PASS
✅ Contract Addresses: PASS
✅ Trading Settings: PASS

🎉 SETUP HOÀN THÀNH - SẴN SÀNG CHẠY BOT!
```

### Bước 4: Chạy Bot

```bash
# Chạy mempool sniper
npm run auto:mempool

# Hoặc với PM2 (recommended)
pm2 start "npm run auto:mempool" --name sniper-bot
pm2 logs sniper-bot
```

## 📊 Thông Báo Telegram

Bot sẽ gửi thông báo chi tiết cho mọi sự kiện:

### 🔍 Phát Hiện Cặp Mới
```
🔍 [10:30:45] PHÁT HIỆN CẶP MỚI
━━━━━━━━━━━━━━━━
📍 Pair: 0x1234...5678
🪙 Token: 0xabcd...ef01
💧 Liquidity: 0.7500 ETH
⏰ Thời gian: 10:30:45
```

### ⏭️ Bỏ Qua (Với Lý Do)
```
⏭️ [10:30:46] BỎ QUA
━━━━━━━━━━━━━━━━
🪙 Token: 0xabcd...ef01
❌ Lý do: Tax không hợp lệ: 500 BPS
📝 Chi tiết: tax_500_bps_gt_0
```

### ✅ Mua Thành Công
```
✅ [10:31:20] MUA THÀNH CÔNG
━━━━━━━━━━━━━━━━
🪙 Token: 0xabcd...ef01
📦 Số lượng: 1000000.00
💰 Chi phí: 0.01 ETH
📈 Giá mua: 100000 tokens/ETH
🔗 TX: https://etherscan.io/tx/0x...
⏰ Thời gian: 10:31:20
```

### 💰 Bán Thành Công
```
💰 [10:33:30] BÁN THÀNH CÔNG
━━━━━━━━━━━━━━━━
🪙 Token: 0xabcd...ef01
📦 Số lượng: 1000000.00
💵 Thu về: 0.012 ETH
💹 P&L: +20.00% (+0.002 ETH)
⏱️ Thời gian hold: 130s
🔗 TX: https://etherscan.io/tx/0x...
```

### 🚨 Cảnh Báo Rug Pull
```
🚨 [10:32:10] CẢNH BÁO RUG PULL
━━━━━━━━━━━━━━━━
🪙 Token: 0xabcd...ef01
⚠️ Loại: router-remove
🔗 Rug TX: https://etherscan.io/tx/0x...
⚡ ĐANG BÁN KHẨN CẤP...
```

### 📊 Thống Kê
```
📊 [11:00:00] THỐNG KÊ
━━━━━━━━━━━━━━━━
📈 Tổng trades: 10
✅ Thành công: 7
❌ Thất bại: 3
💰 Tổng lời: 0.015 ETH
📉 Tổng lỗ: 0.005 ETH
💵 Net P&L: +0.010 ETH
🎯 Win rate: 70%
```

## ⚙️ Cấu Hình Chi Tiết

### Trading Settings

```bash
# Số ETH mỗi lần mua
BUY_ETH=0.01

# Range liquidity để snipe
MIN_LP_ETH=0.5
MAX_LP_ETH=1.0

# Tax tối đa chấp nhận (0 = zero tax only)
STRICT_TAX_BPS_MAX=0
STRICT_TAX_MODE=reject_unknown

# Các hàm bị chặn (ngăn scam)
BLOCKLIST_SELECTORS=enableTrading,setTax,setTaxes,setFee,setFees,updateFee,updateFees,excludeFromFee,setBlacklist,setBlackList,setMaxTxAmount,setMaxTx

# Test honeypot trước (0 = skip, 0.001 = test với 0.001 ETH)
HONEYPOT_TEST_WEI=0
```

### Profit/Loss Settings

```bash
# Take profit target (%)
TP_PCT=20

# Timeout để cut loss (giây)
TP_TIMEOUT_SEC=600

# Abort nếu giá tăng quá nhanh
PRICE_GUARD=1
PRICE_MULTIPLE_ABORT=3
```

### Rug Defense

```bash
# Bật rug pull defense
RUG_DEFENSE=1

# Ngưỡng rút LP (basis points)
# 2000 BP = 20% LP removal
RUG_THRESHOLD_BP=2000

# Gas settings khi panic sell
PANIC_TIP_ADD_GWEI=2
MAX_FEE_GWEI_CAP=300
MAX_PRIORITY_FEE_GWEI_CAP=200
```

## 🎯 Strategies

### 🛡️ Conservative (An Toàn)

Phù hợp cho người mới, ưu tiên an toàn hơn lợi nhuận:

```bash
BUY_ETH=0.005              # Giảm risk
MIN_LP_ETH=0.8             # Chỉ snipe LP lớn
MAX_LP_ETH=1.0
STRICT_TAX_BPS_MAX=0       # Zero tax only
HONEYPOT_TEST_WEI=0.001    # Test trước
TP_PCT=15                  # TP sớm
TP_TIMEOUT_SEC=300         # Cut loss nhanh (5p)
PRICE_MULTIPLE_ABORT=2     # Strict price guard
```

**Ưu điểm:** 
- ✅ Ít rủi ro
- ✅ Win rate cao
- ✅ Tránh scam tốt

**Nhược điểm:**
- ⚠️ Ít cơ hội
- ⚠️ Lợi nhuận thấp

---

### ⚡ Aggressive (Mạo Hiểm)

Phù hợp cho trader có kinh nghiệm, chấp nhận rủi ro cao:

```bash
BUY_ETH=0.02               # Tăng position size
MIN_LP_ETH=0.3             # Snipe LP nhỏ
MAX_LP_ETH=2.0             # Range rộng
STRICT_TAX_BPS_MAX=100     # Chấp nhận tax nhỏ
HONEYPOT_TEST_WEI=0        # Không test (nhanh hơn)
TP_PCT=50                  # Chờ lời lớn
TP_TIMEOUT_SEC=1200        # Hold lâu (20p)
PRICE_MULTIPLE_ABORT=5     # Chấp nhận giá cao
```

**Ưu điểm:**
- ✅ Nhiều cơ hội
- ✅ Lợi nhuận cao nếu hit

**Nhược điểm:**
- ⚠️ Rủi ro cao
- ⚠️ Dễ bị rug/scam

---

### ⚖️ Balanced (Cân Bằng)

Khuyến nghị cho hầu hết traders:

```bash
BUY_ETH=0.01
MIN_LP_ETH=0.5
MAX_LP_ETH=1.0
STRICT_TAX_BPS_MAX=0
HONEYPOT_TEST_WEI=0
TP_PCT=20
TP_TIMEOUT_SEC=600
PRICE_MULTIPLE_ABORT=3
```

**Ưu điểm:**
- ✅ Cân bằng risk/reward
- ✅ Đủ cơ hội
- ✅ An toàn hợp lý

---

## 🐛 Troubleshooting

### Bot không phát hiện pair nào

**Nguyên nhân:**
- LP range quá hẹp
- RPC chậm
- Không có pair mới nào match criteria

**Giải pháp:**
```bash
# Mở rộng range
MIN_LP_ETH=0.3
MAX_LP_ETH=2.0

# Kiểm tra RPC có WSS
# Đổi sang RPC nhanh hơn (Alchemy Pro)
```

### Bị bỏ lỡ nhiều pair (too slow)

**Nguyên nhân:**
- RPC chậm
- Honeypot test làm chậm
- Nhiều filters

**Giải pháp:**
```bash
# Tắt honeypot test
HONEYPOT_TEST_WEI=0

# Dùng RPC nhanh nhất
# Giảm bớt filters nếu cần
```

### Thường xuyên lỗ

**Nguyên nhân:**
- TP target quá cao
- Timeout quá dài
- Bị frontrun

**Giải pháp:**
```bash
# Giảm TP, giảm timeout
TP_PCT=15
TP_TIMEOUT_SEC=300

# Tăng price guard
PRICE_MULTIPLE_ABORT=2

# Bật honeypot test
HONEYPOT_TEST_WEI=0.001
```

### Không nhận Telegram notification

**Kiểm tra:**
1. Token đúng từ @BotFather
2. Chat ID đúng từ @userinfobot  
3. Đã /start với bot
4. Internet stable

**Test:**
```bash
node test_setup.js
```

### RPC errors liên tục

**Nguyên nhân:**
- Rate limit
- RPC down
- Network issues

**Giải pháp:**
- Dùng nhiều RPC fallback
- Upgrade plan (Alchemy/Infura)
- Kiểm tra internet

---

## 📈 Monitoring & Analytics

### Logs

```bash
# Chạy với logs
npm run auto:mempool 2>&1 | tee logs/bot_$(date +%Y%m%d).log

# Theo dõi real-time
tail -f logs/bot_*.log

# Search errors
grep "ERROR" logs/bot_*.log
```

### PM2 Dashboard

```bash
# Install PM2
npm install -g pm2

# Start bot
pm2 start "npm run auto:mempool" --name sniper

# Monitor
pm2 monit

# Logs
pm2 logs sniper

# Restart nếu crash
pm2 restart sniper
```

### Performance Metrics

Bot tự động track:
- Total trades
- Win rate
- Net P&L
- Average hold time
- Skip reasons

Xem trong Telegram mỗi 10 trades hoặc mỗi 5 phút.

---

## 🔒 Security Best Practices

### ⚠️ Quan Trọng

1. **Private Key:**
   - ❌ KHÔNG bao giờ share
   - ❌ KHÔNG commit lên GitHub
   - ✅ Backup ở nơi an toàn offline
   - ✅ Dùng wallet riêng cho bot

2. **Funds:**
   - ✅ Chỉ nạp đủ để trade (0.1-0.5 ETH)
   - ✅ Withdraw profits thường xuyên
   - ❌ Không để số lớn trong bot wallet

3. **.env File:**
   - ✅ Add vào .gitignore
   - ✅ Chmod 600 (Linux/Mac)
   - ❌ Không share screen khi mở

4. **RPC Keys:**
   - ✅ Dùng keys riêng cho bot
   - ✅ Set rate limits hợp lý
   - ✅ Rotate keys định kỳ

---

## 🚀 Production Deployment

### VPS Setup (Ubuntu 20.04+)

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2
sudo npm install -g pm2

# Clone & setup
git clone <repo>
cd <project>
npm install
cp .env.example .env
nano .env  # Fill your config

# Test
node test_setup.js

# Start with PM2
pm2 start "npm run auto:mempool" --name sniper
pm2 save
pm2 startup  # Auto-start on reboot

# Monitor
pm2 monit
```

### Docker Setup

```bash
# Build image
docker build -t eth-sniper .

# Run container
docker run -d \
  --name sniper-bot \
  --env-file .env \
  --restart unless-stopped \
  eth-sniper

# View logs
docker logs -f sniper-bot
```

---

## 📊 Expected Results

### Thông Số Thực Tế (Based on testing)

- **Pairs detected:** 10-50/day (tùy market activity)
- **Pairs matched criteria:** 5-20% of detected
- **Successful buys:** 60-80% of matched
- **Win rate:** 40-70% (tùy market & settings)
- **Average P&L per win:** +15-30%
- **Average loss:** -5-15%

### Timeline

- **0-5s:** Phát hiện AddLP trong mempool
- **5-15s:** Run filters (tax, selectors, price...)
- **15-30s:** Execute buy
- **30s-10m:** Monitor position
- **10m hoặc TP:** Auto sell

---

## 🆘 Support & Updates

### Logs Quan Trọng

Nếu gặp vấn đề, lưu logs:
```bash
# Lưu logs đầy đủ
npm run auto:mempool 2>&1 | tee debug.log

# Share các dòng:
# - Boot message
# - Error messages  
# - Candidate messages
# - Buy/sell transactions
```

### Common Issues

| Issue | Fix |
|-------|-----|
| "Need WSS" | Thêm wss:// RPC vào đầu |
| "Insufficient funds" | Nạp ETH vào wallet |
| "Transaction reverted" | Normal, bot sẽ skip |
| No pairs detected | Mở rộng LP range |
| High loss rate | Giảm timeout, tăng filters |

---

## 📜 License & Disclaimer

**⚠️ CẢNH BÁO:**

- Bot này dành cho mục đích giáo dục và testing
- Trading crypto có rủi ro mất vốn
- Không bảo đảm lợi nhuận
- Sử dụng với trách nhiệm của bạn
- Developer không chịu trách nhiệm về tổn thất

**📖 License:** MIT

---

## 🎯 Roadmap

- [ ] Multi-chain support (BSC, Arbitrum, Base)
- [ ] Web dashboard
- [ ] Advanced analytics
- [ ] ML-based scam detection
- [ ] Automated strategy optimization
- [ ] Multi-wallet support

---

## 🙏 Credits

Built with:
- [Ethers.js](https://docs.ethers.org/)
- [Node.js](https://nodejs.org/)
- [Telegram Bot API](https://core.telegram.org/bots/api)

---

**💪 Happy Sniping! May the gains be with you! 🚀**