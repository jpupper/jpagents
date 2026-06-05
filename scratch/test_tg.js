import 'dotenv/config';
import fetch from 'node-fetch';

try {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  console.log('Token length:', token?.length);
  const resp = await fetch(
    'https://api.telegram.org/bot' + token + '/getMe',
    { signal: AbortSignal.timeout(5000) }
  );
  const text = await resp.text();
  console.log('STATUS:', resp.status);
  console.log('BODY:', text);
} catch(e) {
  console.error('FETCH ERROR:', e.message, e.code);
}
