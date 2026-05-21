const axios = require('axios');

async function debugTTS() {
  const text = 'Salom! Bu ovoz generatsiyasi testidir.';
  
  // Try 3 different URL schemas
  const urls = [
    `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=uz&client=tw-ob`,
    `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=uz&total=1&idx=0&textlen=${text.length}&client=tw-ob`,
    `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=uz&total=1&idx=0&textlen=${text.length}&client=gtx`,
    `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=uz&client=tw-ob&ttsspeed=1`
  ];
  
  for (const url of urls) {
    console.log(`\n--- Probing: ${url} ---`);
    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://translate.google.com/'
        },
        timeout: 5000
      });
      console.log('SUCCESS! Status:', res.status, 'Size:', res.data.length);
    } catch (err) {
      console.log('FAILED! Status:', err.response?.status);
      console.log('Headers:', err.response?.headers);
      if (err.response?.data) {
        const bodyText = Buffer.from(err.response.data).toString('utf8');
        console.log('Body:', bodyText.slice(0, 500));
      }
    }
  }
}

debugTTS();
