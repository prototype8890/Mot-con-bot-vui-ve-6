
import TelegramBot from 'node-telegram-bot-api';

let bot = null;
let chatId = null;

export function initNotifier(token, chat){
  if (!token || !chat) return { send: async ()=>{} };
  bot = new TelegramBot(token, { polling: false });
  chatId = chat;
  return { send: async (msg)=>{
    try{ await bot.sendMessage(chatId, msg, { disable_web_page_preview: true }); }catch{}
  }};
}
