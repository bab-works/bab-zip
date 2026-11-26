// 배포용 Code.gs 만들기: 저장소의 Code.gs를 clasp 폴더의 Code 파일로 (+ 친구 서버 주소·연결 비밀값)
// 앱 비밀번호는 더 이상 코드에 넣지 않음: 시트 스크립트 속성 APP_TOKEN에만 있음 (Code.gs authOk_)
// node put-code.js <저장소 Code.gs> <clasp 폴더>
const fs = require('fs'), path = require('path');
const [src, dir] = process.argv.slice(2), out = fs.readFileSync(src, 'utf8');
if (!/^const TOKEN = '여기에-나만-아는-비밀번호를-적으세요';/m.test(out)) throw new Error('Code.gs의 TOKEN 자리에 비밀번호가 들어 있어요 · 저장소에는 자리표시만 두세요');
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
