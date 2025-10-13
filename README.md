# 🍌 ETH Mempool Scanner → Banana Gun Auto Buyer (Telegram bridge)

Scanner này quét mempool Ethereum, áp dụng bộ lọc an toàn và gửi tín hiệu ngay khi Add Liquidity. Bạn có thể:

- Nhận thông báo để tự tay vào lệnh (giống phiên bản trước), **hoặc**
- Kết nối trực tiếp với Banana Gun qua **Telegram client API** để bot tự động chat lệnh mua/bán bằng tài khoản Telegram của bạn, không cần bất kỳ Banana Gun REST API nào.

## ✨ Tính năng chính

| Tính năng | Mô tả | Trạng thái |
|-----------|-------|------------|
| 🔍 **Realtime AddLP Scan** | Lắng nghe mempool qua WebSocket, phát hiện cặp mới ngay khi có Add Liquidity | ✅ |
| 🛡️ **Smart Filters** | Kiểm tra LP nằm trong khoảng cấu hình, tax ≤ ngưỡng cho phép và không có hàm độc hại | ✅ |
| 📈 **Price Guard** | So sánh giá base/current, bỏ qua nếu bị frontrun > `PRICE_MULTIPLE_ABORT` lần | ✅ |
| 📱 **Telegram Insight** | Candidate + Signal + Skip kèm block/time + link Dexscreener/Etherscan | ✅ |
| 🍌 **Banana Gun Auto Trade** | Tự động chat lệnh Banana Gun qua Telegram, log gas & Banana fee, chênh lệch giá gốc ↔ giá mua | ✅ |
| 💰 **Trade Lifecycle Reports** | Sau mỗi lệnh bán gửi P&L %, lời/lỗ ETH, thời gian hold, gas từng giao dịch | ✅ |
| ⏳ **10 phút Stop-loss** | Sau `AUTO_SELL_TIMEOUT_MINUTES` nếu chưa hòa vốn → bán và báo mức lỗ | ✅ |
| 📊 **Concurrent Trade Guard** | Giới hạn số lệnh xử lý đồng thời qua `MAX_CONCURRENT_TRADES` để tránh nghẽn lệnh | ✅ |
| 🔁 **RPC Auto-Reconnect** | Mất kết nối WSS/HTTP sẽ tự động thử lại, khởi tạo lại watcher và rug defense | ✅ |
| 🚨 **Rug Pull Front-run** | Phát hiện rút LP → gửi Banana Gun sell trước chủ token, thông báo rõ ràng | ✅ |
| 📊 **Session Summary** | Khi dừng bot: tổng kết số lệnh, win rate, lời/lỗ, gas, phí Banana | ✅ |
| 🧠 **ML Token Scoring** | Tính điểm dựa trên LP, tuổi token, lịch sử deployer & thuế để loại kèo rác | ✅ |
| 🪤 **Honeypot Shield** | Giả lập swap, kiểm tra phân bổ LP & cảnh báo honeypot trước khi mua | ✅ |
| 📉 **Smart Stop / Take-Profit** | Trailing stop, take-profit động và stop-loss tự động theo PnL realtime | ✅ |
| 🧯 **Circuit Breaker** | Tạm dừng giao dịch khi chuỗi lỗ ≥ `MAX_CONSECUTIVE_LOSSES`, tự reset sau cooldown | ✅ |
| 🌐 **Multi-DEX Scan** | Hỗ trợ cấu hình nhiều router/factory qua `DEX_CONFIG_JSON` hoặc biến DEX_* | ✅ |
| 📈 **Dashboard & Analytics** | Lưu trade vào SQLite/JSON và mở dashboard web xem trạng thái realtime | ✅ |

## 🧰 Cần chuẩn bị

- Node.js v16 trở lên
- NPM hoặc Yarn
- RPC Endpoint (ưu tiên có WebSocket)
- (Tùy chọn) Telegram Bot Token & Chat ID để nhận thông báo
- (Tùy chọn) Telegram API ID + API Hash + StringSession (GramJS) của tài khoản đang dùng Banana Gun
- (Khuyến nghị) Username bot Banana Gun (mặc định: `@BananaGunBot`)

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
PRICE_GUARD_RETRY_DELAY_MS=250
AUTO_SELL_TIMEOUT_MINUTES=10
RUG_PULL_THRESHOLD_BPS=500
MAX_CONCURRENT_TRADES=3

# Exit & risk controls
TRAILING_STOP_BPS=800
SMART_TP_TARGET_BPS=1500
SMART_TP_TRAIL_BPS=500
MAX_CONSECUTIVE_LOSSES=3
CIRCUIT_BREAKER_COOLDOWN_MINUTES=30
ML_FILTER_ENABLED=1
ML_SCORE_THRESHOLD=62
HONEYPOT_MIN_LP_RATIO=0.02
RETRY_MAX_ATTEMPTS=3
RETRY_BASE_DELAY_MS=200
ANALYTICS_ENABLED=1
ANALYTICS_DB_PATH=data/analytics.db
WEB_DASHBOARD_ENABLED=0
WEB_DASHBOARD_PORT=8787
GAS_OPTIMIZER_CACHE_MS=5000

# Multi-DEX (tùy chọn)
DEX_NAME=UniswapV2
DEX_CHAIN=eth
DEX_SLUG=ethereum
DEX_EXPLORER=etherscan.io
ROUTER_V2=0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D
ROUTER_V2_LIST=
FACTORY_V2=0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f
DEX_CONFIG_JSON=

# Telegram (tùy chọn, để nhận thông báo)
TELEGRAM_TOKEN=1234567890:ABCdef...
TELEGRAM_CHAT_ID=123456789

# Banana Gun auto-buy qua Telegram client (cần đủ 4 biến đầu)
BANANA_GUN_TG_API_ID=123456
BANANA_GUN_TG_API_HASH=0123456789abcdef0123456789abcdef
BANANA_GUN_TG_SESSION=1AQA.... (StringSession do GramJS tạo ra)
BANANA_GUN_TG_BOT=@BananaGunBot
BANANA_GUN_BUY_AMOUNT_ETH=0.2
BANANA_GUN_SLIPPAGE_BPS=500
BANANA_GUN_PRIORITY_FEE_GWEI=3
BANANA_GUN_GAS_MULTIPLIER=1.2
BANANA_GUN_SELL_PERCENT=100
BANANA_GUN_TG_BUY_TEMPLATE=/buy {token} {amount} {slippageBps} {priorityFeeGwei}
BANANA_GUN_TG_SELL_TEMPLATE=/sell {token} {percent}
BANANA_GUN_WALLET_ADDRESS=0xYourBananaWallet
```

👉 Không cần private key hoặc số dư ETH trong dự án này – bot chỉ gửi tin nhắn Telegram tới Banana Gun để thực hiện lệnh hộ bạn.

`MAX_CONCURRENT_TRADES` giúp tránh việc gửi quá nhiều lệnh Banana Gun cùng lúc khi thị trường có nhiều token mới. Khi đạt giới hạn, bot
chỉ gửi thông báo “skip” và chờ các lệnh hiện có hoàn tất.

`PRICE_GUARD_RETRY_DELAY_MS` đặt khoảng nghỉ giữa các lần kiểm tra giá realtime (mặc định 250ms) để bot phản ứng nhanh với biến động nhưng vẫn hạn chế spam RPC. `PRICE_MULTIPLE_ABORT` chấp nhận số thập phân (ví dụ 2.5) nhưng luôn phải > 1.0x để đảm bảo chỉ các kèo bị frontrun quá mạnh mới bị bỏ qua.

`ML_FILTER_ENABLED` bật mô-đun chấm điểm token (0-100). `ML_SCORE_THRESHOLD` càng cao thì bộ lọc càng khắt khe.

`TRAILING_STOP_BPS`, `SMART_TP_TARGET_BPS`, `SMART_TP_TRAIL_BPS` điều khiển trailing stop và take-profit tự động (đơn vị BPS = % * 100).

`MAX_CONSECUTIVE_LOSSES` kết hợp với `CIRCUIT_BREAKER_COOLDOWN_MINUTES` để khóa giao dịch mới sau chuỗi thua lỗ.

`DEX_CONFIG_JSON` chấp nhận mảng JSON giúp quét nhiều router/factory cùng lúc (ví dụ Uniswap + Sushi). Nếu để trống sẽ dùng các biến `DEX_*` mặc định.

`WEB_DASHBOARD_ENABLED=1` mở dashboard tại `http://localhost:WEB_DASHBOARD_PORT` và cung cấp API `/stats` phục vụ giám sát.

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

## 🍌 Auto trade với Banana Gun qua Telegram

Khi thiết lập đủ `BANANA_GUN_TG_API_ID`, `BANANA_GUN_TG_API_HASH`, `BANANA_GUN_TG_SESSION`, `BANANA_GUN_BUY_AMOUNT_ETH`, bot sẽ lo toàn bộ vòng đời giao dịch thông qua Telegram:

1. Gửi lệnh mua theo template `BANANA_GUN_TG_BUY_TEMPLATE` ngay khi token vượt qua filter.
2. Lắng nghe phản hồi từ Banana Gun bot, trích xuất tx hash / Banana fee / gas fee (nếu có) và đẩy vào thông báo.
3. Theo dõi vị thế:
   - Sau `AUTO_SELL_TIMEOUT_MINUTES` (mặc định 10 phút) nếu giá chưa ≥ giá gốc → gửi template bán (`BANANA_GUN_TG_SELL_TEMPLATE`) và báo mức lỗ %.
   - Nếu phát hiện chủ token rút LP (mempool) → gửi lệnh sell ngay trước giao dịch của họ, thông báo rõ ràng.
4. Khi bán xong sẽ gửi báo cáo lời/lỗ (ETH và %) bằng dữ liệu on-chain.
5. Khi dừng bot sẽ tổng kết số lệnh, win rate, tổng lời/lỗ, tổng gas và phí Banana thu được từ phản hồi Telegram.

> ⚠️ Bạn phải tự tạo StringSession (GramJS). Hãy giữ bí mật session như private key vì nó đại diện cho phiên đăng nhập Telegram của bạn.

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
🪙 Token: ABCD (Awesome Token)
💧 LP: 0.7800 ETH
💰 Base Price: 105000.0000 tokens/ETH
💸 Tax: 0 BPS (0.00%)
🛡️ Price Guard: Change: 8.20%
🤖 Auto Banana Gun: 0.20 ETH (slip 500 bps, prio 3 gwei, gas x1.2)
🔗 Banana Gun / Dexscreener / Etherscan
```

### ✅ Banana Gun mua thành công
```
✅ Banana Gun BUY EXECUTED
━━━━━━━━━━━━━━━━
🪙 Token: ABCD (Awesome Token)
📍 Pair: 0x1234...5678
📦 Deploy: #19283740 → Add LP: #19283745 → Buy: #19283747
💸 Gas: 0.0042 ETH | Banana fee: 0.0025 ETH
💰 Giá mua vs giá gốc: +6.12%
```

### 💰 Báo cáo bán ra
```
💰 BANANA SELL EXECUTED
━━━━━━━━━━━━━━━━
🪙 Token: ABCD (Awesome Token)
📊 Reason: Timeout 10 phút
💹 P&L: -6.42% (-0.0123 ETH)
💸 Gas buy: 0.0042 ETH | Gas sell: 0.0038 ETH | Banana fee: 0.0025 ETH
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

### 🚨 Rug pull front-run
```
🚨 RUG PULL DETECTED
━━━━━━━━━━━━━━━━
🪙 Token: ABCD (Awesome Token)
⚠️ Type: router-remove
📦 Block: #19283800

⚡ RUG FRONT-RUN COMPLETED
🪙 Token: ABCD (Awesome Token)
💰 ETH nhận: 0.2150
🔗 Dexscreener / Sell TX
```

## ❓ FAQ

### Scanner có tự mua token không?
- **Có nếu** bạn cấu hình Telegram client (`BANANA_GUN_TG_*`) trong `.env` – bot sẽ dùng chính tài khoản Telegram của bạn để gửi lệnh Banana Gun.
- **Không** nếu bạn bỏ trống cấu hình Telegram – thông báo chỉ dùng để bạn vào lệnh thủ công.

### Có thể thêm filter riêng không?
Có thể chỉnh sửa `BLOCKLIST_SELECTORS`, `STRICT_TAX_BPS_MAX` hoặc tùy biến code trong `src/simple/filters.js` để bổ sung logic riêng.

### Cần bật Telegram không?
Không bắt buộc. Nếu không cấu hình Telegram, scanner sẽ log thông tin trong terminal.

---

Chúc bạn săn được nhiều kèo đẹp – và luôn kiểm tra lại trước khi bắn Banana Gun! 🫡
