const googleTTS = require('google-tts-api');

async function testLib() {
  try {
    const text = 'Salom! Bu google-tts-api kutubxonasi yordamida yozilgan test audio faylidir.';
    console.log('Fetching base64 audio...');
    const base64 = await googleTTS.getAudioBase64(text, {
      lang: 'uz',
      slow: false,
      host: 'https://translate.google.com',
      timeout: 10000
    });
    console.log('SUCCESS! Got base64 string of length:', base64.length);
    const buf = Buffer.from(base64, 'base64');
    console.log('Buffer byte length:', buf.length);
  } catch (err) {
    console.error('FAILED!', err);
  }
}

testLib();
