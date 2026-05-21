const axios = require('axios');

async function testBatch() {
  const text = 'Salom! Bu yangi batchexecute testidir.';
  
  // Try 'uz' and 'uz-UZ'
  for (const lang of ['uz', 'uz-UZ']) {
    console.log(`\n=== Testing lang: ${lang} ===`);
    try {
      const res = await axios({
        method: 'post',
        baseURL: 'https://translate.google.com',
        url: '/_/TranslateWebserverUi/data/batchexecute',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        data: 'f.req=' + encodeURIComponent(JSON.stringify([
          [['jQ1olc', JSON.stringify([text, lang, null, 'generic']), null, 'generic']]
        ]))
      });
      
      console.log('Status:', res.status);
      console.log('Data length:', res.data.length);
      console.log('Raw sample:', res.data.slice(0, 300));
      
      try {
        const cleaned = res.data.slice(5);
        const parsed = JSON.parse(cleaned);
        console.log('Parsed successfully!');
        const inner = parsed[0][2];
        console.log('Inner data available:', !!inner);
        if (inner) {
          const audioData = JSON.parse(inner);
          console.log('Audio base64 length:', audioData[0]?.length);
        }
      } catch (parseErr) {
        console.log('Parse error:', parseErr.message);
      }
    } catch (err) {
      console.error('Request failed:', err.message);
    }
  }
}

testBatch();
