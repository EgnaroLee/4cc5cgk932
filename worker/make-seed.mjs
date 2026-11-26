// 기존 data/trip261225.json 을 D1 에 넣을 SQL 로 만든다. (주인 없는 상태로 들어가며, 로그인 후 README 의 "내 계정으로 연결" 단계를 실행)
// 사용: node worker/make-seed.mjs > worker/seed.sql
import {readFileSync} from 'node:fs';
const d=JSON.parse(readFileSync(new URL('../data/trip261225.json',import.meta.url),'utf8'));
if(!Array.isArray(d.days))throw new Error('days 가 없습니다');
const q=s=>"'"+String(s??'').replace(/'/g,"''")+"'";
const tpl=Number.isInteger(+d.tpl)&&+d.tpl>=0&&+d.tpl<10?+d.tpl:0;
const cover=/^https?:\/\//.test(d.cover||'')?d.cover:'';
console.log(`INSERT OR IGNORE INTO plans(id,owner_id,data,title,sub,start,cover,tpl,updated) VALUES(${q('trip26122501')},NULL,${q(JSON.stringify(d))},${q(String(d.title||'').slice(0,200))},${q(String(d.sub||'').slice(0,200))},${q(String(d.start||'').slice(0,10))},${q(cover)},${tpl},${Math.floor(Date.now()/1000)});`);
