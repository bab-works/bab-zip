// 앱의 APP_VERSION과 sw.js의 CACHE 이름이 같아야 폰이 새 버전을 알아챔
const fs = require('fs'), path = require('path'), assert = require('assert');
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
const sw = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8').match(/CACHE = '([^']+)'/)[1];
assert.equal(app, sw, `app.js ${app} ≠ sw.js ${sw}: 둘 다 올려 주세요`);
console.log('VERSION OK ' + app);
