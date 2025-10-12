\# ✅ CHECKLIST TRƯỚC KHI CHẠY BOT



\## 📋 Bước 1: Chuẩn Bị Cơ Bản



\- \[ ] \*\*Node.js đã cài\*\* (v16+)

&nbsp; ```bash

&nbsp; node --version  # Phải >= v16.0.0

&nbsp; ```



\- \[ ] \*\*Dependencies đã cài\*\*

&nbsp; ```bash

&nbsp; npm install

&nbsp; # Hoặc kiểm tra:

&nbsp; npm list ethers dotenv zod node-telegram-bot-api

&nbsp; ```



\- \[ ] \*\*Files đã sửa lỗi:\*\*

&nbsp; - \[ ] `src/simple/abi.js` - Đã thêm SELECTORS

&nbsp; - \[ ] `src/nonceManager.js` - Đã sửa BigInt → Number

&nbsp; - \[ ] `src/simple/panicSell.js` - Đã sửa ERC20 → IERC20

&nbsp; - \[ ] `src/simple/auto\_mempool.js` - Dùng version mới



---



\## 🔑 Bước 2: Wallet \& RPC



\- \[ ] \*\*Wallet đã tạo\*\*

&nbsp; - \[ ] Có private key

&nbsp; - \[ ] Có wallet address

&nbsp; - \[ ] ⚠️ ĐÃ SAO LƯU an toàn



\- \[ ] \*\*Wallet đã nạp ETH\*\*

&nbsp; - \[ ] Tối thiểu: 0.05 ETH

&nbsp; - \[ ] Khuyến nghị: 0.1 ETH

&nbsp; ```bash

&nbsp; # Kiểm tra balance:

&nbsp; # Vào https://etherscan.io/address/YOUR\_WALLET

&nbsp; ```



\- \[ ] \*\*RPC WebSocket đã có\*\*

&nbsp; - \[ ] Alchemy: `wss://eth-mainnet.g.alchemy.com/v2/...` ✅

&nbsp; - \[ ] Infura: `wss://mainnet.infura.io/ws/v3/...` ✅

&nbsp; - \[ ] QuickNode: `wss://...quicknode.com/...` ✅

&nbsp; - \[ ] ❌ KHÔNG dùng: `https://...` (không có mempool)



\- \[ ] \*\*RPC đã test\*\*

&nbsp; ```bash

&nbsp; # Test WSS connection:

&nbsp; node -e "const {ethers}=require('ethers');new ethers.WebSocketProvider('wss://YOUR\_RPC').getBlockNumber().then(b=>console.log('Block:',b))"

&nbsp; ```



---



\## 📱 Bước 3: Telegram



\- \[ ] \*\*Bot đã tạo\*\*

&nbsp; - \[ ] Đã nhắn @BotFather → /newbot

&nbsp; - \[ ] Đã lưu token: `1234567890:ABC...`

&nbsp; - \[ ] Bot username: `@your\_bot\_name`



\- \[ ] \*\*Chat ID đã lấy\*\*

&nbsp; - \[ ] Nhắn @userinfobot

&nbsp; - \[ ] Lưu ID: `123456789`



\- \[ ] \*\*Bot đã kích hoạt\*\*

&nbsp; - \[ ] Tìm bot username trên Telegram

&nbsp; - \[ ] Bấm /start

&nbsp; - \[ ] Thấy "Hi!" hoặc tương tự



---



\## ⚙️ Bước 4: File .env



\- \[ ] \*\*File .env đã tạo\*\*

&nbsp; ```bash

&nbsp; # Kiểm tra:

&nbsp; ls -la .env

&nbsp; # Hoặc:

&nbsp; cat .env

&nbsp; ```



\- \[ ] \*\*Các giá trị BẮT BUỘC đã điền:\*\*



&nbsp; ```bash

&nbsp; # RPC (WSS phải ở đầu)

&nbsp; RPC\_URLS=wss://eth-mainnet.g.alchemy.com/v2/YOUR\_KEY,...

&nbsp; 

&nbsp; # Wallet

&nbsp; PRIVATE\_KEY=0x1234567890abcdef...

&nbsp; WALLET\_ADDRESS=0xYourAddress...

&nbsp; 

&nbsp; # Telegram

&nbsp; TELEGRAM\_TOKEN=1234567890:ABCdef...

&nbsp; TELEGRAM\_CHAT\_ID=123456789

&nbsp; ```



\- \[ ] \*\*Các giá trị KHUYẾN NGHỊ:\*\*

&nbsp; ```bash

&nbsp; BUY\_ETH=0.01                # Số ETH mỗi lần mua

&nbsp; MIN\_LP\_ETH=0.5              # LP tối thiểu

&nbsp; MAX\_LP\_ETH=1.0              # LP tối đa

&nbsp; STRICT\_TAX\_BPS\_MAX=0        # Chỉ chấp nhận tax = 0

&nbsp; TP\_PCT=20                   # Take profit 20%

&nbsp; TP\_TIMEOUT\_SEC=600          # Timeout 10 phút

&nbsp; RUG\_DEFENSE=1               # Bật rug defense

&nbsp; RUG\_THRESHOLD\_BP=2000       # 20% LP removal = rug

&nbsp; PRICE\_MULTIPLE\_ABORT=3      # Hủy nếu giá >3x

&nbsp; ```



\- \[ ] \*\*Đã kiểm tra syntax .env\*\*

&nbsp; ```bash

&nbsp; # Test load .env:

&nbsp; node -r dotenv/config -e "console.log(process.env.PRIVATE\_KEY ? '✅ .env OK' : '❌ .env Error')"

&nbsp; ```



---



\## 🧪 Bước 5: Test Kết Nối



\- \[ ] \*\*Test RPC\*\*

&nbsp; ```bash

&nbsp; node -r dotenv/config -e "const {ethers}=require('ethers');const p=new ethers.JsonRpcProvider(process.env.RPC\_URLS.split(',')\[1]);p.getBlockNumber().then(b=>console.log('✅ Block:',b)).catch(e=>console.error('❌',e.message))"

&nbsp; ```



\- \[ ] \*\*Test Wallet Balance\*\*

&nbsp; ```bash

&nbsp; node -r dotenv/config -e "const {ethers}=require('ethers');const p=new ethers.JsonRpcProvider(process.env.RPC\_URLS.split(',')\[1]);p.getBalance(process.env.WALLET\_ADDRESS).then(b=>console.log('✅ Balance:',ethers.formatEther(b),'ETH')).catch(e=>console.error('❌',e.message))"

&nbsp; ```



\- \[ ] \*\*Test Telegram Bot\*\*

&nbsp; ```bash

&nbsp; # Chạy và xem có nhận message không:

&nbsp; node -r dotenv/config -e "const TelegramBot=require('node-telegram-bot-api');const bot=new TelegramBot(process.env.TELEGRAM\_TOKEN,{polling:false});bot.sendMessage(process.env.TELEGRAM\_CHAT\_ID,'✅ Test message from bot').then(()=>console.log('✅ Telegram OK')).catch(e=>console.error('❌',e.message))"

&nbsp; ```



\- \[ ] \*\*Test WebSocket\*\*

&nbsp; ```bash

&nbsp; node -r dotenv/config -e "const {ethers}=require('ethers');const ws=process.env.RPC\_URLS.split(',')\[0];if(!ws.startsWith('wss')){console.error('❌ First RPC must be WSS');process.exit(1)}const p=new ethers.WebSocketProvider(ws);p.on('block',n=>{console.log('✅ WSS OK - Block:',n);process.exit(0)});setTimeout(()=>{console.error('❌ WSS Timeout');process.exit(1)},10000)"

&nbsp; ```



---



\## 🎯 Bước 6: Kiểm Tra Logic Bot



\- \[ ] \*\*Filters hoạt động\*\*

&nbsp; - \[ ] Tax detection: Có thể phát hiện tax

&nbsp; - \[ ] Selector scan: Có thể phát hiện hàm nguy hiểm

&nbsp; - \[ ] Price guard: Tính toán giá đúng



\- \[ ] \*\*Trading functions OK\*\*

&nbsp; - \[ ] `buyExactETH` - Có thể mua token

&nbsp; - \[ ] `sellAll` - Có thể bán token

&nbsp; - \[ ] Approve hoạt động



\- \[ ] \*\*Monitoring setup\*\*

&nbsp; - \[ ] Position manager hoạt động

&nbsp; - \[ ] TP/Timeout logic đúng

&nbsp; - \[ ] Rug watcher hoạt động (nếu có WSS)



---



\## 🚀 Bước 7: Chạy Bot Lần Đầu



\### 7.1 Dry Run (Khuyến nghị)



Trước khi chạy thật, test với settings an toàn:



```bash

\# Tạo file .env.test

cp .env .env.test



\# Sửa settings test:

\# BUY\_ETH=0.005  (giảm xuống)

\# MIN\_LP\_ETH=10  (tăng lên để không match pair nào)

```



\- \[ ] \*\*Chạy với .env.test\*\*

&nbsp; ```bash

&nbsp; node -r dotenv/config src/simple/auto\_mempool.js

&nbsp; ```



\- \[ ] \*\*Kiểm tra logs:\*\*

&nbsp; - \[ ] ✅ "BOT KHỞI ĐỘNG" xuất hiện

&nbsp; - \[ ] ✅ Balance hiển thị đúng

&nbsp; - \[ ] ✅ RPC kết nối OK

&nbsp; - \[ ] ✅ Telegram nhận được boot message



\- \[ ] \*\*Để chạy 5-10 phút\*\*

&nbsp; - \[ ] Không có crash

&nbsp; - \[ ] Không có lỗi RPC

&nbsp; - \[ ] Console log smooth



\### 7.2 Live Run



\- \[ ] \*\*Backup .env\*\*

&nbsp; ```bash

&nbsp; cp .env .env.backup

&nbsp; ```



\- \[ ] \*\*Settings cuối cùng:\*\*

&nbsp; ```bash

&nbsp; BUY\_ETH=0.01              # Start small

&nbsp; MIN\_LP\_ETH=0.5

&nbsp; MAX\_LP\_ETH=1.0

&nbsp; TP\_PCT=20

&nbsp; TP\_TIMEOUT\_SEC=600

&nbsp; HONEYPOT\_TEST\_WEI=0       # Bỏ test để nhanh hơn

&nbsp; ```



\- \[ ] \*\*Chạy production:\*\*

&nbsp; ```bash

&nbsp; # Chạy với logs

&nbsp; npm run auto:mempool 2>\&1 | tee logs/bot\_$(date +%Y%m%d\_%H%M%S).log

&nbsp; 

&nbsp; # Hoặc chạy background (Linux/Mac)

&nbsp; nohup npm run auto:mempool > bot.log 2>\&1 \&

&nbsp; 

&nbsp; # Hoặc dùng PM2 (khuyến nghị)

&nbsp; npm install -g pm2

&nbsp; pm2 start "npm run auto:mempool" --name sniper-bot

&nbsp; pm2 logs sniper-bot

&nbsp; ```



---



\## 📊 Bước 8: Giám Sát 30 Phút Đầu



\- \[ ] \*\*Theo dõi Telegram:\*\*

&nbsp; - \[ ] Nhận được "BOT KHỞI ĐỘNG"

&nbsp; - \[ ] Nhận được "PHÁT HIỆN CẶP MỚI" (nếu có pair match)

&nbsp; - \[ ] Nhận được "BỎ QUA" với lý do rõ ràng



\- \[ ] \*\*Theo dõi Console:\*\*

&nbsp; - \[ ] Không có error đỏ liên tục

&nbsp; - \[ ] Block number tăng đều

&nbsp; - \[ ] Memory không tăng quá nhanh



\- \[ ] \*\*Theo dõi Etherscan:\*\*

&nbsp; - \[ ] Nếu có buy, check TX trên Etherscan

&nbsp; - \[ ] Xem gas usage hợp lý

&nbsp; - \[ ] Confirm TX success



---



\## 🔧 Bước 9: Tối Ưu Dựa Trên Kết Quả



\### Nếu không phát hiện pair nào:



\- \[ ] Mở rộng LP range:

&nbsp; ```bash

&nbsp; MIN\_LP\_ETH=0.3

&nbsp; MAX\_LP\_ETH=2.0

&nbsp; ```



\- \[ ] Kiểm tra factory address đúng:

&nbsp; ```bash

&nbsp; FACTORY\_V2=0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f

&nbsp; ```



\- \[ ] Đổi sang RPC nhanh hơn



\### Nếu bị bỏ qua nhiều pair:



\- \[ ] Xem lý do trong Telegram

\- \[ ] Nếu "Tax không hợp lệ" nhiều → Tăng `STRICT\_TAX\_BPS\_MAX=100`

\- \[ ] Nếu "Giá đã tăng" nhiều → Tăng `PRICE\_MULTIPLE\_ABORT=5`



\### Nếu mua được nhưng thường lỗ:



\- \[ ] Giảm timeout:

&nbsp; ```bash

&nbsp; TP\_TIMEOUT\_SEC=300  # 5 phút thay vì 10

&nbsp; ```



\- \[ ] Tăng TP target:

&nbsp; ```bash

&nbsp; TP\_PCT=30  # 30% thay vì 20%

&nbsp; ```



\- \[ ] Bật honeypot test:

&nbsp; ```bash

&nbsp; HONEYPOT\_TEST\_WEI=0.001

&nbsp; ```



---



\## 🛑 Bước 10: Shutdown An Toàn



Khi muốn tắt bot:



\- \[ ] \*\*Nhấn Ctrl+C\*\* (hoặc `pm2 stop sniper-bot`)



\- \[ ] \*\*Đợi bot:\*\*

&nbsp; - \[ ] Bán hết positions

&nbsp; - \[ ] Gửi stats cuối

&nbsp; - \[ ] Exit gracefully



\- \[ ] \*\*Lưu logs:\*\*

&nbsp; ```bash

&nbsp; cp bot.log logs/session\_$(date +%Y%m%d\_%H%M%S).log

&nbsp; ```



\- \[ ] \*\*Review performance:\*\*

&nbsp; - \[ ] Xem stats cuối cùng

&nbsp; - \[ ] Tính P\&L

&nbsp; - \[ ] Note lessons learned



---



\## 📈 Bước 11: Performance Review (Sau 1 Ngày)



\- \[ ] \*\*Thống kê:\*\*

&nbsp; - \[ ] Tổng pairs phát hiện: \_\_\_

&nbsp; - \[ ] Pairs skip: \_\_\_ (lý do: \_\_\_)

&nbsp; - \[ ] Trades thực hiện: \_\_\_

&nbsp; - \[ ] Win rate: \_\_\_%

&nbsp; - \[ ] Net P\&L: \_\_\_ ETH



\- \[ ] \*\*Điều chỉnh strategy:\*\*

&nbsp; - \[ ] Nếu win rate < 40% → Conservative settings

&nbsp; - \[ ] Nếu win rate > 60% → Có thể tăng buy amount

&nbsp; - \[ ] Nếu miss nhiều pair → Tăng range, giảm filters



---



\## ⚠️ RED FLAGS - Dừng Ngay Nếu:



\- \[ ] ❌ Balance giảm > 20% trong 1 giờ

\- \[ ] ❌ Liên tục lỗi RPC

\- \[ ] ❌ Bot crash > 3 lần/giờ

\- \[ ] ❌ Không nhận Telegram notification

\- \[ ] ❌ Memory leak (RAM tăng liên tục)



---



\## 🎯 SUCCESS CHECKLIST



Sau khi bot chạy ổn định, bạn nên thấy:



\- \[x] ✅ Bot online 24/7 không crash

\- \[x] ✅ Nhận notification mọi action

\- \[x] ✅ Win rate > 50%

\- \[x] ✅ Net positive P\&L

\- \[x] ✅ Không bị rug pull

\- \[x] ✅ Tự động TP/SL đúng logic



---



\## 📞 Troubleshooting Quick Reference



| Lỗi | Giải pháp |

|-----|-----------|

| "RPC\_URLS missing" | Thêm RPC vào .env |

| "need WSS" | Dùng wss:// ở đầu RPC\_URLS |

| "insufficient funds" | Nạp thêm ETH |

| "Transaction reverted" | Bot tự động skip, OK |

| Telegram không nhận | Check token/chatID, bấm /start |

| Không phát hiện pair | Mở rộng LP range, check factory |

| Mua được nhưng lỗ | Giảm timeout, tăng TP%, bật test |



---



\## 🎓 Pro Tips



1\. \*\*Start Small:\*\* Test với 0.005-0.01 ETH trước

2\. \*\*Monitor Closely:\*\* Xem logs 1-2 giờ đầu

3\. \*\*Adjust Gradually:\*\* Không thay đổi nhiều settings cùng lúc

4\. \*\*Log Everything:\*\* Lưu logs để phân tích

5\. \*\*Backup .env:\*\* Trước khi thay đổi gì

6\. \*\*Use PM2:\*\* Để bot tự restart nếu crash

7\. \*\*Set Alerts:\*\* Telegram notification là must-have

8\. \*\*Review Daily:\*\* Xem stats hàng ngày để improve



---



\## ✅ FINAL CHECK BEFORE LIVE



Trước khi để bot chạy không giám sát:



\- \[ ] Balance đủ cho 10+ trades

\- \[ ] Telegram hoạt động 100%

\- \[ ] Đã test dry run thành công

\- \[ ] Settings phù hợp với risk tolerance

\- \[ ] Logs được lưu tự động

\- \[ ] Biết cách stop emergency

\- \[ ] Đã backup private key an toàn



---



\*\*🚀 NẾU TẤT CẢ ✅ → SẴN SÀNG CHẠY BOT!\*\*



Good luck và trade an toàn! 💰

