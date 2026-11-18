import { appendFile } from 'node:fs/promises';
import { workerUrl } from '../apps-script/deploy/worker-url.mjs';

import { snapshot } from './run.mjs';
const {CF_ACCOUNT,CF_TOKEN,BRIDGE,APP_TOKEN}=process.env;
const keys=['me','lists','habits'];
async function run() {
  const url=await workerUrl(CF_ACCOUNT,CF_TOKEN);
  async function post(body,headers={}) {
    const res=await fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'text/plain',...headers},body:JSON.stringify(body)});
    if(!res.ok) throw Error();
    const data=await res.json();
    if(!data.ok) throw Error();
    return data;
  }
  const owner=await post({what:'me'},{Authorization:'Bearer '+BRIDGE});
  const friend=owner.friends?.[0];
  if(!friend) throw Error();
  const samples={}, backup={};
  await snapshot(async (endpoint,proof)=>{
    async function old(what) {
      const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain'},redirect:'manual',
        body:JSON.stringify({what,guest:friend.code,ownerToken:APP_TOKEN,proof})});
      const target=r.headers.get('location');
      if(!target || new URL(target).origin!=='https://script.googleusercontent.com') throw Error();
      const data=await (await fetch(target,{redirect:'error'})).json();
      if(!data.ok) throw Error();
    }
    async function current(what){
      const data=await post({what,token:friend.code});
      if(what==='me'?data.role!=='friend':!data[what]) throw Error();
    }
    for(const what of keys){
      samples[what]=[];backup[what]=[];
      for(let i=0;i<3;i++) {
        const pair=[[old,backup],[current,samples]];
        for(const [read,times] of i%2?pair.reverse():pair){
          const start=performance.now();
          await read(what);
          times[what].push(Math.round(performance.now()-start));
        }
      }
    }
  });
  const format=data=>keys.map(k=>data[k].join(',')).join('/');
  await appendFile(process.env.GITHUB_OUTPUT,'result='+format(samples)+'\nbaseline='+format(backup)+'\n');
  await appendFile(process.env.GITHUB_STEP_SUMMARY,'같은 실행기의 재측정(ms) / 내 정보·취미 목록·습관 순서\n\n시트 '+format(backup)+'\n\nWorker '+format(samples)+'\n');
}
run().catch(()=>{console.error('조회 측정 실패');process.exitCode=1;});
