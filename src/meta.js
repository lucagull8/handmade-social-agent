import axios from 'axios';

const GRAPH = 'https://graph.facebook.com/v21.0';

export async function createInstagramMediaContainer(igUserId, imageUrl, caption, token) {
  const res = await axios.post(`${GRAPH}/${igUserId}/media`, {
    image_url: imageUrl,
    caption,
    access_token: token
  });
  return res.data.id;
}

export async function publishInstagramMedia(igUserId, containerId, token) {
  const res = await axios.post(`${GRAPH}/${igUserId}/media_publish`, {
    creation_id: containerId,
    access_token: token
  });
  return res.data.id;
}

export async function postToFacebookPage(pageId, message, imageUrl, pageToken) {
  const res = await axios.post(`${GRAPH}/${pageId}/photos`, {
    url: imageUrl,
    message,
    access_token: pageToken
  });
  return res.data.id;
}

export async function refreshLongLivedToken(appId, appSecret, token) {
  const res = await axios.get(`${GRAPH}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: token
    }
  });
  return res.data.access_token;
}
