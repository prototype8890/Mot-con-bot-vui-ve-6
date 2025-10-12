import TelegramBot from 'node-telegram-bot-api';
export function createTg(botToken, chatId) {
  if (!botToken || !chatId) return null;
  const bot = new TelegramBot(botToken, { polling: false });
  return { send: async (text) => { try { await bot.sendMessage(chatId, text, { disable_web_page_preview: true }); } catch {} } };
}
