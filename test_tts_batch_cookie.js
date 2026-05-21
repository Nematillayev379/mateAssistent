const axios = require('axios');

async function testBatchWithCookie() {
  const text = 'Salom! Bu yangi batchexecute testidir.';
  const lang = 'uz';
  
  try {
    console.log('Step 1: Fetching Google Translate homepage to get cookies...');
    const homeRes = await axios.get('https://translate.google.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 5000
    });
    
    const setCookie = homeRes.headers['set-cookie'];
    console.log('Cookies received:', setCookie);
    const cookieHeader = setCookie ? setCookie.map(c => c.split(';')[0]).join('; ') : '';
    
    console.log('\nStep 2: Sending batchexecute request with cookies...');
    const res = await axios({
      method: 'post',
      baseURL: 'https://translate.google.com',
      url: '/_/TranslateWebserverUi/data/batchexecute',
      headers: {
        'Cookie': cookieHeader,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://translate.google.com/'
      },
      data: 'f.req=' + encodeURIComponent(JSON.stringify([
        [['jQ1olc', JSON.stringify([text, lang, null, 'generic']), null, 'generic']]
      ]))
    });
    
    console.log('Status:', res.status);
    console.log('Raw response sample:', res.data.slice(0, 300));
    
    try {
      const cleaned = res.data.slice(5);
      const parsed = JSON.parse(cleaned);
      const inner = parsed[0][2];
      console.log('Inner data exists:', !!inner);
      if (inner) {
        const audioData = JSON.parse(inner);
        console.log('SUCCESS! Audio base64 length:', audioData[0]?.length);
      }
    } catch (e) {
      console.log('Parse failed:', e.message);
    }
  } catch (err) {
    console.error('Request failed:', err.message);
  }
}

testBatchWithCookie();
