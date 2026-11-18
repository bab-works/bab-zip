import { appendFile } from 'node:fs/promises';
import { workerUrl } from '../apps-script/deploy/worker-url.mjs';

const {CF_ACCOUNT,CF_TOKEN,BRIDGE,GH_TOKEN,GITHUB_REPOSITORY}=process.env;
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
  const samples={};
  for(const key of keys) {
    samples[key]=[];
    if (!friend) continue;
    for(let i=0;i<3;i++) {
      const start=performance.now();
      const data=await post({what:key,token:friend.code});
      if(key==='me' ? data.role!=='friend' : !data[key]) throw Error();
      samples[key].push(Math.round(performance.now()-start));
    }
  }
  // Pull only numerical timings from the completed cutover check, if the API supplies its summary.
  const res=await fetch('https://api.github.com/repos/'+GITHUB_REPOSITORY+'/check-runs/134847048136',{headers:{Authorization:'Bearer '+GH_TOKEN,'User-Agent':'friend-speed'}});
  const output=res.ok ? (await res.json()).output : {};
  const match=[output?.summary,output?.text].join(' ').match(/\{"me":\[[\d,]*\],"lists":\[[\d,]*\],"habits":\[[\d,]*\]\}/);
  const format=data=>keys.map(k=>data[k].join(',')||'empty').join('/');
  await appendFile(process.env.GITHUB_OUTPUT,'result='+format(samples)+'\nbaseline='+(match?format(JSON.parse(match[0])):'summary')+'\n');
  await appendFile(process.env.GITHUB_STEP_SUMMARY,'운영 Worker 응답 시간(ms) '+format(samples)+'\n');
}
run().catch(()=>{console.error('조회 측정 실패');process.exitCode=1;});
