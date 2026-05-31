const fs = require('fs');
const path = require('path');

function fixFileEncoding(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const isUtf16le = buf[0] === 0xff && buf[1] === 0xfe;
    if (!isUtf16le) return false;
    const text = buf.toString('utf16le');
    fs.writeFileSync(filePath, text, 'utf8');
    console.log(`Fixed: ${path.basename(filePath)}`);
    return true;
  } catch(e) { return false; }
}

// Fix main repo .git/HEAD
const mainGit = 'C:\\Users\\msi\\Desktop\\rss-bot\\uzbekistan\\.git';
if (fixFileEncoding(path.join(mainGit, 'HEAD'))) {
  console.log('Fixed main HEAD');
}

// Fix testgit .git/HEAD if needed
const testGit = 'C:\\Users\\msi\\Desktop\\rss-bot\\uzbekistan\\testgit\\.git';
if (fixFileEncoding(path.join(testGit, 'HEAD'))) {
  console.log('Fixed testgit HEAD');
}

// Fix any UTF-16 ref files
const walkRefs = (dir) => {
  try {
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) walkRefs(full);
      else if (item === 'main' && fixFileEncoding(full)) console.log(`Fixed ref: ${full}`);
    }
  } catch(e) {}
};
walkRefs(path.join(mainGit, 'refs'));
walkRefs(path.join(testGit, 'refs'));

console.log('Done.');
