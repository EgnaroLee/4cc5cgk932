// Cloudflare Worker: 비밀번호 확인 후 GitHub의 플랜북 데이터(data/<id>.json)와 목록(plans.json)을 읽고/커밋하는 중계 서버
// 필요한 Variables/Secrets: ADMIN_PASSWORD(secret), GITHUB_TOKEN(secret), OWNER, REPO, ALLOW_ORIGIN, (선택) BRANCH
const J=(o,s,c)=>new Response(JSON.stringify(o),{status:s,headers:{...c,'Content-Type':'application/json'}});
const same=(a,b)=>{a=String(a||'');b=String(b||'');let d=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return d===0};
const u8=s=>btoa(unescape(encodeURIComponent(s)));
const de=s=>decodeURIComponent(escape(atob(s.replace(/\n/g,''))));
const ID=/^[a-z0-9-]{1,40}$/;
export default{async fetch(req,env){
  const c={'Access-Control-Allow-Origin':env.ALLOW_ORIGIN,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type',Vary:'Origin'};
  if(req.method==='OPTIONS')return new Response(null,{headers:c});
  if(req.method!=='POST')return J({error:'method'},405,c);
  let b;try{b=await req.json()}catch{return J({error:'bad'},400,c)}
  if(!same(b.pw,env.ADMIN_PASSWORD)){await new Promise(r=>setTimeout(r,800));return J({error:'pw'},401,c)}
  const op=b.op,isPlans=op==='plans_get'||op==='plans_put';
  // 대상 파일: plans_* → plans.json / id 있음 → data/<id>.json / id 없음(하위 호환) → data.json
  let path,label;
  if(isPlans){path='plans.json';label='plans'}
  else if(b.id===undefined||b.id===null){path='data.json';label='data'}
  else{
    if(typeof b.id!=='string'||!ID.test(b.id))return J({error:'id'},400,c);
    path='data/'+b.id+'.json';label=b.id;
  }
  const br=env.BRANCH||'main',url=`https://api.github.com/repos/${env.OWNER}/${env.REPO}/contents/${path}`;
  const H={Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','User-Agent':'planbook-worker'};
  const getF=()=>fetch(url+'?ref='+br,{headers:H});
  if(op==='get'||op==='plans_get'){
    const r=await getF();if(r.status===404)return J({data:null},200,c);
    if(!r.ok)return J({error:'gh'+r.status},502,c);
    return J({data:JSON.parse(de((await r.json()).content))},200,c);
  }
  if(op==='put'||op==='plans_put'){
    const d=b.data;
    if(op==='put'){
      if(!d||!Array.isArray(d.days)||JSON.stringify(d).length>300000)return J({error:'data'},400,c);
    }else{
      const p=d&&d.plans;
      if(!Array.isArray(p)||p.length>50||!p.every(x=>typeof x==='string'&&ID.test(x))||new Set(p).size!==p.length)return J({error:'data'},400,c);
    }
    for(let n=0;n<2;n++){
      const g=await getF(),sha=g.ok?(await g.json()).sha:undefined;
      const r=await fetch(url,{method:'PUT',headers:H,body:JSON.stringify({message:'플랜북 갱신 '+label+' '+new Date().toISOString(),content:u8(JSON.stringify(d,null,1)),branch:br,sha})});
      if(r.ok)return J({ok:true},200,c);
      if(r.status!==409&&r.status!==422)return J({error:'gh'+r.status},502,c);
    }
    return J({error:'conflict'},409,c);
  }
  return J({error:'op'},400,c);
}};
