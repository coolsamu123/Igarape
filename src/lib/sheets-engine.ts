import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'data', 'service-account.json');

export async function fetchSheetCsv(sheetId: string, gid: string): Promise<string> {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error('Service account key not found');
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  const client = await auth.getClient();
  const token = await client.getAccessToken();

  if (!token || !token.token) {
    throw new Error('Failed to get access token');
  }

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token.token}`
    }
  });

  if (!res.ok) {
    const text = await res.text();
    if (text.includes('Accès refusé') || res.status === 403 || res.status === 404) {
      throw new Error(`Access Denied. Please share the Google Sheet with the service account email: al-bco-e9997-talend-etl@al-bco-e9997-talend-etl-292614.iam.gserviceaccount.com`);
    }
    throw new Error(`Failed to fetch sheet: ${res.statusText}`);
  }

  return res.text();
}
