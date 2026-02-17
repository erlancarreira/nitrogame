const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, 'public/assets');
const codeDirs = ['app', 'components', 'lib', 'hooks'];
const keepListPath = path.join(__dirname, 'keep-assets.txt');

function getAllFiles(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;

    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
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
                if (file.match(/\.(js|ts|tsx)$/)) {
                    content += fs.readFileSync(file, 'utf8');
                }
            });
        }
    });
    return content;
}

function loadKeepList() {
    if (!fs.existsSync(keepListPath)) return [];
    return fs.readFileSync(keepListPath, 'utf8')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
}

const allAssets = getAllFiles(assetsDir);
const codeContent = getCodeContent();
const keepList = loadKeepList();

const unused = allAssets.filter(asset => {
    const relative = asset.split('public')[1].replace(/\\/g, '/');

    const isKept = keepList.some(k => relative.startsWith(k));
    const isReferenced = codeContent.includes(relative);

    return !isKept && !isReferenced;
});

console.log('\n🔴 POSSÍVEIS NÃO USADOS:\n');
unused.forEach(file => console.log(file));

console.log('\nTotal candidatos a remoção:', unused.length);
