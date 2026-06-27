import 'dotenv/config';
import { listImages, downloadImageAsBase64, makeFilePublic } from '../src/drive.js';
import { generatePost } from '../src/ai.js';
import { sendPhotoWithButtons } from '../src/telegram.js';
import { readState, saveState, addPost, getLastPublishedPosts, getPendingPosts } from '../src/state.js';

const FOLDER_DA_PUBBLICARE = process.env.GOOGLE_DRIVE_FOLDER_DA_PUBBLICARE;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function main() {
  const state = readState();

  const pending = getPendingPosts(state);
  if (pending.length > 0) {
    console.log(`Già ${pending.length} post in attesa. Skip.`);
    return;
  }

  const files = await listImages(FOLDER_DA_PUBBLICARE);
  if (files.length === 0) {
    console.log('Nessuna immagine in "Da Pubblicare". Operazione completata.');
    return;
  }

  const file = files[0];
  console.log(`Elaborando: ${file.name} (${file.id})`);

  const imageBase64 = await downloadImageAsBase64(file.id);
  const mimeType = file.mimeType || 'image/jpeg';
  const lastPosts = getLastPublishedPosts(state, 3);

  console.log('Generando copy con AI...');
  const { testo, hashtag } = await generatePost(imageBase64, mimeType, lastPosts);

  const imageUrl = await makeFilePublic(file.id);
  const caption = `${testo}\n\n${hashtag.map(h => `#${h.replace(/^#/, '')}`).join(' ')}`;

  console.log('Inviando proposta su Telegram...');
  const message = await sendPhotoWithButtons(CHAT_ID, imageUrl, caption, file.id);

  addPost(state, {
    drive_file_id: file.id,
    drive_file_name: file.name,
    testo,
    hashtag,
    image_url: imageUrl,
    telegram_message_id: message.message_id
  });
  saveState(state);

  console.log(`✅ Proposta inviata. Message ID: ${message.message_id}`);
}

main().catch(err => {
  console.error('❌ Errore propose.js:', err.message);
  process.exit(1);
});
