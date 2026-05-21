const axios = require('axios');

async function testEN() {
  const url = 'https://translate.google.com/translate_tts?client=tw-ob&tl=en&q=Hello';
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    console.log('EN SUCCESS!', res.status, res.data.length);
  } catch (err) {
    console.log('EN FAILED!', err.message);
  }
}

testEN();
