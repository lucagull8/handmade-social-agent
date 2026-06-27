/**
 * Script di setup ONE-TIME per generare i token Meta.
 *
 * PRIMA DI ESEGUIRE:
 * 1. In developers.facebook.com → HandmadeByLeila → Impostazioni app → Di base
 *    → sezione "Facebook Login" → aggiungi URI redirect: http://localhost:3000/callback
 * 2. Crea file .env con META_APP_ID e META_APP_SECRET
 *
 * ESEGUI: node scripts/setup-token.js
 */

import 'dotenv/config';
import http from 'http';
import { exec } from 'child_process';
import axios from 'axios';
import * as readline from 'readline';

const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const REDIRECT_URI = 'http://localhost:3000/callback';
const GRAPH = 'https://graph.facebook.com/v21.0';

if (!APP_ID || !APP_SECRET) {
  console.error('❌ Crea un file .env con META_APP_ID e META_APP_SECRET');
  process.exit(1);
}

const SCOPES = [
  'instagram_basic',
  'instagram_content_publishing',
  'pages_read_engagement',
  'pages_show_list',
  'business_management',
  'pages_manage_posts'
].join(',');

const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${SCOPES}&response_type=code`;

console.log('\n🚀 Setup token Meta\n');
console.log('Aprendo browser per autorizzazione Facebook...\n');

// Open browser (Windows)
exec(`start "" "${oauthUrl}"`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error_description');

  if (error) {
    res.end(`<h2>❌ Errore: ${error}</h2>`);
    server.close();
    return;
  }

  if (!code) {
    res.end('<h2>In attesa di autorizzazione...</h2>');
    return;
  }

  res.end('<html><body style="font-family:sans-serif;padding:2em"><h2>✅ Autorizzato! Torna al terminale.</h2></body></html>');
  server.close();

  try {
    console.log('✅ Autorizzazione ricevuta. Scambio codice per token...');

    const tokenRes = await axios.get(`${GRAPH}/oauth/access_token`, {
      params: { client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: REDIRECT_URI, code }
    });
    const shortToken = tokenRes.data.access_token;

    console.log('Scambio per long-lived token (60 giorni)...');
    const longRes = await axios.get(`${GRAPH}/oauth/access_token`, {
      params: { grant_type: 'fb_exchange_token', client_id: APP_ID, client_secret: APP_SECRET, fb_exchange_token: shortToken }
    });
    const longToken = longRes.data.access_token;

    const meRes = await axios.get(`${GRAPH}/me`, { params: { access_token: longToken, fields: 'id,name' } });
    console.log(`\n👤 Autenticato come: ${meRes.data.name} (${meRes.data.id})`);

    const accountsRes = await axios.get(`${GRAPH}/me/accounts`, {
      params: { access_token: longToken, fields: 'id,name,access_token' }
    });

    const pages = accountsRes.data.data || [];

    let pageId, pageToken;

    if (pages.length > 0) {
      const page = pages.find(p => p.name.toLowerCase().includes('leila')) || pages[0];
      pageId = page.id;
      pageToken = page.access_token;
      console.log(`\n📄 Pagina trovata: ${page.name} (${page.id})`);
    } else {
      console.log('\n⚠️  Nessuna pagina da /me/accounts (New Pages Experience).');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      pageId = await new Promise(resolve => rl.question('Inserisci il Page ID manualmente: ', ans => { rl.close(); resolve(ans.trim()); }));
      pageToken = longToken;
    }

    let igUserId = null;
    try {
      const igRes = await axios.get(`${GRAPH}/${pageId}`, {
        params: { fields: 'instagram_business_account', access_token: pageToken }
      });
      igUserId = igRes.data.instagram_business_account?.id;
    } catch (e) {
      console.log('⚠️  Impossibile recuperare IG user ID automaticamente.');
    }

    console.log('\n' + '='.repeat(65));
    console.log('🔑 SALVA QUESTI VALORI COME GITHUB SECRETS (Settings → Secrets):');
    console.log('='.repeat(65));
    console.log(`META_APP_ID            = ${APP_ID}`);
    console.log(`META_APP_SECRET        = ${APP_SECRET}`);
    console.log(`META_USER_ACCESS_TOKEN = ${longToken}`);
    console.log(`META_PAGE_ACCESS_TOKEN = ${pageToken}`);
    console.log(`META_PAGE_ID           = ${pageId}`);
    console.log(`META_IG_USER_ID        = ${igUserId ?? 'DA_TROVARE_MANUALMENTE'}`);
    console.log('='.repeat(65));

    if (!igUserId) {
      console.log('\n⚠️  Per trovare META_IG_USER_ID:');
      console.log('   Graph API Explorer → GET /{PAGE_ID}?fields=instagram_business_account');
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Errore:', err.response?.data || err.message);
    process.exit(1);
  }
});

server.listen(3000, () => console.log('Server locale in ascolto su http://localhost:3000...'));
