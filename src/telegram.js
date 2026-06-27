import axios from 'axios';

const BASE = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export async function sendPhotoWithButtons(chatId, photoUrl, caption, driveFileId) {
  const res = await axios.post(`${BASE()}/sendPhoto`, {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: 'Approva ✅', callback_data: `approve:${driveFileId}` },
        { text: 'Rifiuta ❌', callback_data: `reject:${driveFileId}` }
      ]]
    }
  });
  return res.data.result;
}

export async function getUpdates(offset = 0) {
  const res = await axios.get(`${BASE()}/getUpdates`, {
    params: { offset, timeout: 10, allowed_updates: ['callback_query'] }
  });
  return res.data.result;
}

export async function answerCallbackQuery(callbackQueryId, text) {
  await axios.post(`${BASE()}/answerCallbackQuery`, {
    callback_query_id: callbackQueryId,
    text
  });
}

export async function sendMessage(chatId, text) {
  await axios.post(`${BASE()}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'HTML'
  });
}
