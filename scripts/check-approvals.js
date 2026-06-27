import 'dotenv/config';
import { getUpdates, answerCallbackQuery, sendMessage } from '../src/telegram.js';
import { createInstagramMediaContainer, publishInstagramMedia, postToFacebookPage } from '../src/meta.js';
import { moveFile } from '../src/drive.js';
import { readState, saveState, updatePostStatus } from '../src/state.js';

const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const IG_USER_ID = process.env.META_IG_USER_ID;
const PAGE_ID = process.env.META_PAGE_ID;
const PAGE_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const FOLDER_DA_PUBBLICARE = process.env.GOOGLE_DRIVE_FOLDER_DA_PUBBLICARE;
const FOLDER_ARCHIVIO = process.env.GOOGLE_DRIVE_FOLDER_ARCHIVIO;

async function publishPost(post) {
  const caption = `${post.testo}\n\n${post.hashtag.map(h => `#${h.replace(/^#/, '')}`).join(' ')}`;

  console.log('Pubblicando su Instagram...');
  const containerId = await createInstagramMediaContainer(IG_USER_ID, post.image_url, caption, PAGE_TOKEN);
  await new Promise(r => setTimeout(r, 5000));
  const igPostId = await publishInstagramMedia(IG_USER_ID, containerId, PAGE_TOKEN);
  console.log(`✅ Instagram: ${igPostId}`);

  console.log('Pubblicando su Facebook...');
  const fbPostId = await postToFacebookPage(PAGE_ID, caption, post.image_url, PAGE_TOKEN);
  console.log(`✅ Facebook: ${fbPostId}`);

  return { igPostId, fbPostId };
}

async function main() {
  const state = readState();
  const updates = await getUpdates(state.telegram_offset);

  if (updates.length === 0) {
    console.log('Nessun aggiornamento Telegram.');
    return;
  }

  for (const update of updates) {
    state.telegram_offset = update.update_id + 1;

    if (!update.callback_query) continue;

    const { id: callbackId, data } = update.callback_query;
    const [action, driveFileId] = data.split(':');

    const post = state.posts.find(p => p.drive_file_id === driveFileId && p.status === 'pending');

    if (!post) {
      await answerCallbackQuery(callbackId, 'Post non trovato o già elaborato.');
      continue;
    }

    if (action === 'approve') {
      // Guard: non ripubblicare post già pubblicati
      if (post.status === 'published') {
        await answerCallbackQuery(callbackId, 'Post già pubblicato.');
        continue;
      }

      try {
        const { igPostId, fbPostId } = await publishPost(post);
        await moveFile(driveFileId, FOLDER_DA_PUBBLICARE, FOLDER_ARCHIVIO);
        updatePostStatus(state, driveFileId, 'published', { igPostId, fbPostId });
        saveState(state);
        await answerCallbackQuery(callbackId, '✅ Pubblicato!');
        await sendMessage(CHAT_ID, `✅ Post pubblicato!\n📸 IG: ${igPostId}\n📘 FB: ${fbPostId}`);
      } catch (err) {
        console.error('Errore pubblicazione:', err.message);
        await answerCallbackQuery(callbackId, '❌ Errore pubblicazione');
        await sendMessage(CHAT_ID, `❌ Errore: ${err.message}`);
      }

    } else if (action === 'reject') {
      updatePostStatus(state, driveFileId, 'rejected');
      saveState(state);
      await answerCallbackQuery(callbackId, '❌ Rifiutato');
      await sendMessage(CHAT_ID, '❌ Post rifiutato. File rimane in "Da Pubblicare".');
    }
  }

  saveState(state);
  console.log(`✅ Elaborati ${updates.length} aggiornamenti.`);
}

main().catch(err => {
  console.error('❌ Errore check-approvals.js:', err.message);
  process.exit(1);
});
