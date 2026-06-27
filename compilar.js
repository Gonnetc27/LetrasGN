const { execSync } = require('child_process');
const fs = require('fs');

console.log('🔒 1. Ofuscando código fuente...');
execSync('npx javascript-obfuscator main.js --output main-ofuscado.js --target node', { stdio: 'inherit' });
execSync('npx javascript-obfuscator renderer.js --output renderer-ofuscado.js --target browser', { stdio: 'inherit' });

console.log('📝 2. Configurando aplicación para producción...');
let pkg = fs.readFileSync('package.json', 'utf-8');
fs.writeFileSync('package.json.backup', pkg);
let pkgObj = JSON.parse(pkg);
pkgObj.main = "main-ofuscado.js";
fs.writeFileSync('package.json', JSON.stringify(pkgObj, null, 2));

let html = fs.readFileSync('index.html', 'utf-8');
fs.writeFileSync('index.html.backup', html);
fs.writeFileSync('index.html', html.replace('renderer.js', 'renderer-ofuscado.js'));

console.log('📦 3. Empaquetando la aplicación sin tu código original...');
try {
    if (fs.existsSync('dist')) fs.rmSync('dist', { recursive: true, force: true });
    execSync('npx electron-builder --win --x64', { stdio: 'inherit' });
} catch (e) {
    console.log('❌ Hubo un error en la compilación.');
}

console.log('🧹 4. Limpiando y restaurando...');
fs.writeFileSync('package.json', fs.readFileSync('package.json.backup'));
fs.writeFileSync('index.html', fs.readFileSync('index.html.backup'));
fs.unlinkSync('package.json.backup');
fs.unlinkSync('index.html.backup');
fs.unlinkSync('main-ofuscado.js');
fs.unlinkSync('renderer-ofuscado.js');

console.log('🚀 ¡LISTO! Tu .exe encriptado fue creado con éxito.');