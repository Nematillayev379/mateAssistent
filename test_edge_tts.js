const { EdgeTTS } = require('@andresaya/edge-tts');
const fs = require('fs');

async function testEdge() {
  try {
    const text = 'Salom! Bu Microsoft Edge TTS dan olingan ovoz sinovi.';
    console.log('Generating...');
    
    const tts = new EdgeTTS();
    await tts.synthesize(text, 'uz-UZ-MadinaNeural', { outputFormat: 'audio-24khz-48kbitrate-mono-mp3' });
    const buffer = await tts.toBuffer();
    
    console.log('SUCCESS! Buffer size:', buffer.length, 'bytes');
    fs.writeFileSync('test_edge.mp3', buffer);
    console.log('Saved to test_edge.mp3');
  } catch (error) {
    console.error('FAILED!', error.message);
  }
}

testEdge();
