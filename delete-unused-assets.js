const fs = require('fs');
const path = require('path');

const listPath = path.join(__dirname, 'unused-to-delete.txt');

if (!fs.existsSync(listPath)) {
    console.log('Arquivo unused-to-delete.txt não encontrado.');
    process.exit();
}

const files = fs.readFileSync(listPath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

files.forEach(file => {
    if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log('Deletado:', file);
    }
});

console.log('\nFinalizado.');
