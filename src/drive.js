import { google } from 'googleapis';

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
}

export async function listImages(folderId) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    orderBy: 'createdTime',
    fields: 'files(id, name, mimeType)',
    pageSize: 1
  });
  return res.data.files;
}

export async function downloadImageAsBase64(fileId) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data).toString('base64');
}

export async function makeFilePublic(fileId) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' }
  });
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

export async function moveFile(fileId, fromFolderId, toFolderId) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  await drive.files.update({
    fileId,
    addParents: toFolderId,
    removeParents: fromFolderId,
    fields: 'id, parents'
  });
}
