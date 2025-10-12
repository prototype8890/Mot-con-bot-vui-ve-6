# 🍌 ETH Mempool Scanner → Banana Gun Auto Buyer

Scanner này quét mempool Ethereum, áp dụng bộ lọc an toàn và gửi tín hiệu ngay khi Add Liquidity. Bạn có thể:

- Nhận thông báo để tự tay vào lệnh (giống phiên bản trước), **hoặc**
- Cung cấp API của Banana Gun để bot tự động gửi lệnh mua với số lượng ETH định sẵn trong `.env`.

## ✨ Tính năng chính

| Tính năng | Mô tả | Trạng thái |
|-----------|-------|------------|
| 🔍 **Realtime AddLP Scan** | Lắng nghe mempool qua WebSocket, phát hiện cặp mới ngay khi có Add Liquidity | ✅ |
| 🛡️ **Smart Filters** | Kiểm tra LP nằm trong khoảng cấu hình, tax ≤ ngưỡng cho phép và không có hàm độc hại | ✅ |
| 📈 **Price Guard** | So sánh giá base/current, bỏ qua nếu bị frontrun > `PRICE_MULTIPLE_ABORT` lần | ✅ |
| 📱 **Rich Telegram Alerts** | Gửi Candidate, Skip lý do chi tiết và Signal đã pass filter | ✅ |
| 🍌 **Banana Gun Ready** | Link sẵn tới Banana Gun + Dexscreener/Etherscan để bạn thao tác trong vài giây | ✅ |
| 🤖 **Banana Gun Auto Buy** | Tự động gửi lệnh snipe Banana Gun với số tiền cố định khi token vượt qua mọi filter | ✅ |

## 🧰 Cần chuẩn bị

- Node.js v16 trở lên
- NPM hoặc Yarn
- RPC Endpoint (ưu tiên có WebSocket)
- (Tùy chọn) Telegram Bot Token & Chat ID để nhận thông báo
- (Tùy chọn) Banana Gun API URL + API Key + Wallet ID nếu muốn auto-buy

## 🚀 Cài đặt nhanh

```bash
# Clone project
git clone <your-repo>
cd <project-folder>

# Cài dependency
npm install
```

## ⚙️ Cấu hình `.env`

```bash
cp .env.example .env
nano .env
```

Các biến chính:

```
RPC_URLS=wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY,https://eth.llamarpc.com
MIN_LP_ETH=0.5
MAX_LP_ETH=1.0
STRICT_TAX_BPS_MAX=0
STRICT_TAX_MODE=reject_unknown
BLOCKLIST_SELECTORS=setTax,blacklist
PRICE_GUARD=1
PRICE_MULTIPLE_ABORT=3

# Telegram (tùy chọn)
TELEGRAM_TOKEN=1234567890:ABCdef...
TELEGRAM_CHAT_ID=123456789

# Banana Gun auto-buy (tùy chọn, cần đủ 4 biến đầu)
BANANA_GUN_API_URL=https://api.bananagun.io/v1/orders
BANANA_GUN_API_KEY=your_api_key
BANANA_GUN_WALLET_ID=wallet_id_tu_Banana_Gun
BANANA_GUN_BUY_AMOUNT_ETH=0.2
BANANA_GUN_SLIPPAGE_BPS=500
BANANA_GUN_PRIORITY_FEE_GWEI=3
BANANA_GUN_GAS_MULTIPLIER=1.2
BANANA_GUN_AUTO_APPROVE=1
```

👉 Không cần private key hoặc số dư ETH trong dự án này – mọi giao dịch được Banana Gun xử lý qua API của bạn.

## ✅ Kiểm tra cấu hình

```bash
node test_setup.js
```

Script sẽ kiểm tra `.env`, kết nối RPC, contract mặc định, Telegram và trạng thái cấu hình Banana Gun. Nếu tất cả PASS, bạn sẵn sàng chạy.

## ▶️ Chạy scanner

```bash
npm run auto:mempool
```

- Nếu dùng PM2:

```bash
pm2 start "npm run auto:mempool" --name mempool-scanner
pm2 logs mempool-scanner
```

## 🍌 Tùy chọn: Auto-buy với Banana Gun

Khi 4 biến `BANANA_GUN_API_URL`, `BANANA_GUN_API_KEY`, `BANANA_GUN_WALLET_ID`, `BANANA_GUN_BUY_AMOUNT_ETH` được thiết lập, bot sẽ tự gửi POST request tới API Banana Gun ngay sau khi token vượt qua mọi filter.

Luồng hoạt động:

1. `🍌 SIGNAL READY` xuất hiện (có kèm thông tin auto-buy: amount, slippage, priority fee…).
2. Bot gửi payload tới Banana Gun (chuẩn JSON, xem `BananaGunClient`), bạn nhận thêm thông báo `🤖 Banana Gun ORDER SENT` hoặc `⚠️ ORDER FAILED` trên Telegram.
3. Nếu muốn can thiệp thủ công, hãy mở link Banana Gun trong thông báo và kiểm tra lệnh trực tiếp.

> ⚠️ Lưu ý: API Banana Gun khác nhau theo tài khoản. Hãy tham khảo tài liệu/discord Banana Gun để lấy endpoint chính xác và cấu hình headers bổ sung nếu cần (`BANANA_GUN_EXTRA_HEADERS`).

## 📨 Mẫu thông báo

### 🔍 Candidate vừa AddLP
```
🔍 CANDIDATE DETECTED
━━━━━━━━━━━━━━━━
📍 Pair: 0x1234...5678
🪙 Token: 0xabcd...ef01
💧 LP: 0.7800 ETH
📦 Block: #19283746
🔗 Dexscreener / Etherscan
```

### ⏭️ Skip (Lý do cụ thể)
```
⏭️ SKIPPED
━━━━━━━━━━━━━━━━
🪙 Token: 0xabcd...ef01
💧 LP: 0.2000 ETH
❌ Lý do: tax_500_bps_gt_0
📝 Chi tiết: Tax 500 BPS exceeds limit 0 BPS
```

### 🍌 Signal + Auto-buy
```
🍌 SIGNAL READY
━━━━━━━━━━━━━━━━
🪙 Token: 0xabcd...ef01
💧 LP: 0.7800 ETH
💰 Base Price: 105000.0000 tokens/ETH
💸 Tax: 0 BPS (0.00%)
🛡️ Price Guard: Change: 8.20%
🤖 Auto Banana Gun: 0.20 ETH (slip 500 bps, prio 3 gwei, gas x1.2)
🔗 Banana Gun / Dexscreener / Etherscan
```

### 🤖 Banana Gun order thành công
```
🤖 Banana Gun ORDER SENT
━━━━━━━━━━━━━━━━
🪙 Token: 0xabcd...ef01
💰 Amount: 0.20 ETH
📦 Block: #19283746
📄 Status: submitted
📝 Banana Gun response: {...}
```

### ⚠️ Banana Gun order thất bại
```
⚠️ Banana Gun ORDER FAILED
━━━━━━━━━━━━━━━━
🪙 Token: 0xabcd...ef01
💰 Amount: 0.20 ETH
❗ Error: Token disabled by Banana Gun risk filter
📝 Response: {...}
```

## ❓ FAQ

### Scanner có tự mua token không?
- **Có nếu** bạn cấu hình Banana Gun API trong `.env` (bot sẽ gửi lệnh auto ngay khi token đạt tiêu chí).
- **Không** nếu bạn bỏ trống cấu hình Banana Gun – thông báo chỉ dùng để bạn vào lệnh thủ công.

### Có thể thêm filter riêng không?
Có thể chỉnh sửa `BLOCKLIST_SELECTORS`, `STRICT_TAX_BPS_MAX` hoặc tùy biến code trong `src/simple/filters.js` để bổ sung logic riêng.

### Cần bật Telegram không?
Không bắt buộc. Nếu không cấu hình Telegram, scanner sẽ log thông tin trong terminal.

---

Chúc bạn săn được nhiều kèo đẹp – và luôn kiểm tra lại trước khi bắn Banana Gun! 🫡
