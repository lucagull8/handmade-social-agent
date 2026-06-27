import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(__dirname, '..', 'state.json');

const DEFAULT_STATE = { telegram_offset: 0, posts: [] };

export function readState() {
  if (!existsSync(STATE_PATH)) return { ...DEFAULT_STATE };
  return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
}

export function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function getPendingPosts(state) {
  return state.posts.filter(p => p.status === 'pending');
}

export function addPost(state, post) {
  state.posts.push({
    drive_file_id: post.drive_file_id,
    drive_file_name: post.drive_file_name,
    status: 'pending',
    testo: post.testo,
    hashtag: post.hashtag,
    image_url: post.image_url,
    telegram_message_id: post.telegram_message_id,
    timestamp: new Date().toISOString()
  });
  return state;
}

export function updatePostStatus(state, driveFileId, status, extra = {}) {
  const post = state.posts.find(p => p.drive_file_id === driveFileId);
  if (post) {
    post.status = status;
    post.updated_at = new Date().toISOString();
    Object.assign(post, extra);
  }
  return state;
}

export function getLastPublishedPosts(state, n = 3) {
  return state.posts
    .filter(p => p.status === 'published')
    .slice(-n)
    .map(p => `${p.testo} ${(p.hashtag || []).join(' ')}`);
}
