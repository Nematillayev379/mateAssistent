const axios = require('axios');

async function testTTS() {
  const domains = [
    'translate.google.com',
    'translate.google.co.uz',
    'translate.google.cn',
    'translate.google.co.uk',
    'translate.google.com.hk'
  ];
  
  const text = 'Salom! Bu ovoz generatsiyasi testidir. Tizim qanchalik tez ishlashini tekshiramiz.';
  
  for (const client of ['tw-ob', 'gtx']) {
    console.log(`\n=== Testing client=${client} ===`);
    for (const domain of domains) {
      const start = Date.now();
      try {
        const url = `https://${domain}/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=uz&client=${client}`;
        const res = await axios.get(url, {
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': `https://${domain}/`
          },
          timeout: 3000
        });
        const duration = Date.now() - start;
        console.log(`[SUCCESS] Domain: ${domain} -> Status: ${res.status}, Size: ${res.data.byteLength} bytes, Time: ${duration}ms`);
      } catch (err) {
        const duration = Date.now() - start;
        console.log(`[FAILED] Domain: ${domain} -> Error: ${err.message}, Time: ${duration}ms`);
      }
    }
  }
}

testTTS();
