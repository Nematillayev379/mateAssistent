const axios = require('axios');

async function testWithCookie() {
  const domain = 'translate.google.com';
  const text = 'Salom! Bu kuki yordamida tekshirilayotgan ovoz testidir.';
  
  try {
    console.log('Step 1: Fetching Google Translate homepage to get cookies...');
    const homeRes = await axios.get(`https://${domain}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 5000
    });
    
    const setCookie = homeRes.headers['set-cookie'];
    console.log('Cookies received:', setCookie);
    
    if (!setCookie) {
      console.log('No set-cookie header found, continuing anyway...');
    }
    
    const cookieHeader = setCookie ? setCookie.map(c => c.split(';')[0]).join('; ') : '';
    console.log('Formatted Cookie Header:', cookieHeader);
    
    console.log('\nStep 2: Requesting TTS with cookies...');
    const url = `https://${domain}/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=uz&client=tw-ob`;
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': `https://${domain}/`
      },
      timeout: 5000
    });
    
    console.log(`[SUCCESS] Status: ${res.status}, Size: ${res.data.byteLength} bytes`);
  } catch (err) {
    console.error(`[FAILED] Error: ${err.message}`);
    if (err.response) {
      console.log('Status:', err.response.status);
      console.log('Headers:', err.response.headers);
    }
  }
}

testWithCookie();
