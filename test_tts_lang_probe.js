const axios = require('axios');

async function probe() {
  const cases = [
    { client: 'tw-ob', tl: 'ru', q: 'Привет' },
    { client: 'tw-ob', tl: 'tr', q: 'Merhaba' },
    { client: 'tw-ob', tl: 'uz', q: 'Salom' },
    { client: 'gtx', tl: 'uz', q: 'Salom' },
    { client: 'dict-chrome-ex', tl: 'uz', q: 'Salom' },
    { client: 'p', tl: 'uz', q: 'Salom' },
    { client: 'tw-ob', tl: 'uz-UZ', q: 'Salom' },
    { client: 'gtx', tl: 'uz-UZ', q: 'Salom' }
  ];
  
  for (const c of cases) {
    const url = `https://translate.google.com/translate_tts?client=${c.client}&tl=${c.tl}&q=${encodeURIComponent(c.q)}`;
    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      console.log(`[SUCCESS] Client: ${c.client}, Lang: ${c.tl} -> Status: ${res.status}, Size: ${res.data.length} bytes`);
    } catch (err) {
      console.log(`[FAILED] Client: ${c.client}, Lang: ${c.tl} -> Error: ${err.message}`);
    }
  }
}

probe();
