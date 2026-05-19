#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const platform = process.platform;
const arch = process.arch;

console.log('🔧 Installing yt-dlp for cross-platform compatibility...');

let downloadUrl;
let fileName;

// Platform-specific downloads
switch (platform) {
  case 'win32':
    if (arch === 'x64') {
      downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
      fileName = 'yt-dlp.exe';
    } else {
      downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
      fileName = 'yt-dlp.exe';
    }
    break;
  case 'darwin':
    if (arch === 'x64') {
      downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
      fileName = 'yt-dlp';
    } else if (arch === 'arm64') {
      downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
      fileName = 'yt-dlp';
    } else {
      downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
      fileName = 'yt-dlp';
    }
    break;
  case 'linux':
    downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
    fileName = 'yt-dlp';
    break;
  default:
    console.log(`⚠️  Platform ${platform} not supported. Skipping yt-dlp installation.`);
    process.exit(0);
}

const filePath = path.join(process.cwd(), fileName);

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    
    function performGet(currentUrl) {
      https.get(currentUrl, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // BUG #101 Fix: Recursive redirect support
          performGet(response.headers.location);
        } else if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        } else {
          reject(new Error(`Failed to download: ${response.statusCode}`));
        }
      }).on('error', (err) => {
        file.close();
        fs.unlinkSync(destination);
        reject(err);
      });
    }

    performGet(url);
  });
}

async function installYtdlp() {
  try {
    // Check if already installed and working
    if (fs.existsSync(filePath)) {
      try {
        const version = execSync(`"${filePath}" --version`, { timeout: 10000, stdio: 'pipe' });
        console.log(`✅ yt-dlp is already installed and working. Version: ${version.toString().trim()}`);
        return;
      } catch (error) {
        console.log('⚠️  Existing yt-dlp binary is not working. Re-installing...');
      }
    }

    console.log(`📥 Downloading yt-dlp for ${platform}-${arch}...`);
    await downloadFile(downloadUrl, filePath);
    
    // Make executable on Unix systems
    if (platform !== 'win32') {
      try {
        fs.chmodSync(filePath, '755');
        console.log('✅ Made yt-dlp executable');
      } catch (error) {
        console.warn('⚠️  Could not make yt-dlp executable:', error.message);
      }
    }
    
    // Verify installation
    let verified = false;
    try {
      const version = execSync(`"${filePath}" --version`, { timeout: 10000, stdio: 'pipe' });
      console.log(`✅ yt-dlp verified! Version: ${version.toString().trim()}`);
      verified = true;
    } catch (error) {
      console.log('⚠️  Primary yt-dlp binary failed verification. trying alternative...');
    }

    if (!verified && platform === 'linux') {
      const altUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_musllinux';
      console.log(`📥 Downloading musl (Alpine) build from: ${altUrl}`);
      try {
        await downloadFile(altUrl, filePath);
        fs.chmodSync(filePath, '755');
        const version = execSync(`"${filePath}" --version`, { timeout: 10000, stdio: 'pipe' });
        console.log(`✅ musl yt-dlp verified successfully! Version: ${version.toString().trim()}`);
        verified = true;
      } catch (altError) {
        console.error('❌ musl build also failed verification:', altError.message);
      }
    }

    if (!verified) {
      console.warn('⚠️  yt-dlp could not be verified but installation completed. Fallback to API remains active.');
    }
    
  } catch (error) {
    console.error('❌ Failed to install yt-dlp:', error.message);
    process.exit(1);
  }
}

installYtdlp();
