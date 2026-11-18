// 배포용 Code.gs 만들기: 저장소의 Code.gs(비밀번호 자리만 비어 있음)에 비밀번호를 넣어 clasp 폴더의 Code 파일을 바꿈
// node put-code.js <저장소 Code.gs> <clasp 폴더>   (비밀번호는 환경변수 APP_TOKEN)
const fs = require('fs'), path = require('path');
const [src, dir] = process.argv.slice(2), token = process.env.APP_TOKEN || '';
if (!token || /['\\\n]/.test(token)) throw new Error('APP_TOKEN 비밀값이 없거나 쓸 수 없는 글자(따옴표·역슬래시·줄바꿈)가 있어요');
const line = /^const TOKEN = '여기에-나만-아는-비밀번호를-적으세요';/m, code = fs.readFileSync(src, 'utf8');
if (!line.test(code)) throw new Error('Code.gs에서 비밀번호 자리를 못 찾았어요');
const out = code.replace(line, () => `const TOKEN = '${token}';`); // 함수로 넘겨야 비밀번호 속 $ 기호가 특수문자로 안 읽힘
// clasp pull은 Code.gs를 Code.js로 받음 (설정에 따라 .gs). 있는 쪽을 바꿈
const target = ['Code.js', 'Code.gs'].map(f => path.join(dir, f)).find(f => fs.existsSync(f));
if (!target) throw new Error('받아온 프로젝트에 Code 파일이 없어요: ' + fs.readdirSync(dir).join(', '));
fs.writeFileSync(target, out);
console.log('Code 파일 교체:', path.basename(target), `(${out.length}자)`);
if (process.env.FRIEND_BRIDGE_SECRET) {
  (async()=>{
    const {workerUrl}=await import('./worker-url.mjs');
    const url=await workerUrl(process.env.CF_ACCOUNT,process.env.CF_TOKEN);
    const source=out.replace("const FRIEND_WORKER_ = '';",()=> 'const FRIEND_WORKER_ = '+JSON.stringify(url)+';')
      .replace("const FRIEND_BRIDGE_ = '';",()=> 'const FRIEND_BRIDGE_ = '+JSON.stringify(process.env.FRIEND_BRIDGE_SECRET)+';');
    fs.writeFileSync(target,source);
  })().catch(()=>{console.error('친구 Worker 배포 설정 확인 필요');process.exitCode=1;});
}
