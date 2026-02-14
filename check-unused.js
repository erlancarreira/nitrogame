const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, 'public/assets');
const codeDirs = ['app', 'components', 'lib', 'hooks'];

function getAllFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(filePath));
    } else {
      results.push(filePath);
    }
  });
  return results;
}

function getCodeContent() {
  let content = '';
  codeDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      const files = getAllFiles(dir);
      files.forEach(file => {
        if (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.tsx')) {
          content += fs.readFileSync(file, 'utf8');
        }
      });
    }
  });
  return content;
}

const allAssets = getAllFiles(assetsDir);
const codeContent = getCodeContent();

const unused = allAssets.filter(asset => {
  const relative = asset.split('public')[1].replace(/\\/g, '/');
  return !codeContent.includes(relative);
});

console.log('\n🔴 UNUSED FILES:\n');
unused.forEach(file => console.log(file));

console.log('\nTotal unused:', unused.length);
