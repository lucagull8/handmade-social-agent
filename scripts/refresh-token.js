import 'dotenv/config';
import axios from 'axios';

const GRAPH = 'https://graph.facebook.com/v21.0';

async function main() {
  const { META_APP_ID, META_APP_SECRET, META_USER_ACCESS_TOKEN } = process.env;

  if (!META_USER_ACCESS_TOKEN) throw new Error('META_USER_ACCESS_TOKEN non configurato');

  const res = await axios.get(`${GRAPH}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: META_APP_ID,
      client_secret: META_APP_SECRET,
      fb_exchange_token: META_USER_ACCESS_TOKEN
    }
  });

  const days = Math.round(res.data.expires_in / 86400);
  console.log(`✅ Token rinnovato (scade tra ~${days} giorni).`);
  console.log('\nAggiorna GitHub Secret META_USER_ACCESS_TOKEN con:');
  console.log(res.data.access_token);
}

main().catch(err => {
  console.error('❌ Errore refresh-token.js:', err.response?.data || err.message);
  process.exit(1);
});
