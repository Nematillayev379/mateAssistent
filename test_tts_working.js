const axios = require('axios');

async function testVarious() {
  const text = 'Salom';
  
  const testUrls = [
    // Standard URL with different client parameter values
    `https://translate.google.com/translate_tts?client=tw-ob&tl=uz&q=${encodeURIComponent(text)}`,
    `https://translate.google.com/translate_tts?client=gtx&tl=uz&q=${encodeURIComponent(text)}`,
    `https://translate.google.com/translate_tts?client=tw-ob&tl=uz&ie=UTF-8&q=${encodeURIComponent(text)}`,
    
    // googleapis endpoints
    `https://translate.googleapis.com/translate_tts?client=gtx&tl=uz&q=${encodeURIComponent(text)}`,
    `https://translate.googleapis.com/translate_tts?client=tw-ob&tl=uz&q=${encodeURIComponent(text)}`
  ];
  
  for (const url of testUrls) {
    console.log(`\nTesting: ${url}`);
    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 5000
      });
      console.log(`[SUCCESS] Status: ${res.status}, Type: ${res.headers['content-type']}, Size: ${res.data.length || res.data.byteLength} bytes`);
    } catch (err) {
      console.log(`[FAILED] Status: ${err.response?.status}, Error: ${err.message}`);
    }
  }
}

testVarious();
