// Cloudflare Worker: 소셜 로그인(Google/Kakao) + 사용자별 플랜북 저장(D1)
// Bindings : DB (D1)
// Vars     : ALLOW_ORIGIN (사이트 origin, 쉼표로 여러 개 가능. 예: https://egnarolee.github.io)
// Secrets  : SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, KAKAO_REST_KEY, (선택) KAKAO_CLIENT_SECRET
const enc=new TextEncoder(),dec=new TextDecoder();
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64u=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const rnd=n=>crypto.getRandomValues(new Uint8Array(n));
const tok=(n=32)=>b64u(rnd(n));
const lid=n=>[...rnd(n)].map(x=>'abcdefghijklmnopqrstuvwxyz0123456789'[x%36]).join('');
const sha=async s=>b64u(await crypto.subtle.digest('SHA-256',enc.encode(s)));
const hmac=async(k,s)=>{const key=await crypto.subtle.importKey('raw',enc.encode(k),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64u(await crypto.subtle.sign('HMAC',key,enc.encode(s)))};
const same=(a,b)=>{a=String(a||'');b=String(b||'');let d=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return d===0};
const ID=/^[a-z0-9]{12}$/,MAX=300000,MAXPLANS=50,SESSION_DAYS=30;
const now=()=>Math.floor(Date.now()/1000);

const PROV={
  google:{auth:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',me:'https://openidconnect.googleapis.com/v1/userinfo',scope:'openid profile',
    key:e=>e.GOOGLE_CLIENT_ID,secret:e=>e.GOOGLE_CLIENT_SECRET,user:j=>({pid:j.sub,name:j.name})},
  kakao:{auth:'https://kauth.kakao.com/oauth/authorize',token:'https://kauth.kakao.com/oauth/token',me:'https://kapi.kakao.com/v2/user/me',scope:'profile_nickname',
    key:e=>e.KAKAO_REST_KEY,secret:e=>e.KAKAO_CLIENT_SECRET,user:j=>({pid:j.id==null?'':String(j.id),name:j.kakao_account?.profile?.nickname||j.properties?.nickname})}
};
const origins=env=>String(env.ALLOW_ORIGIN||'').split(',').map(s=>s.trim().replace(/\/$/,'')).filter(Boolean);
const okReturn=(env,u)=>{try{const x=new URL(u);return origins(env).includes(x.origin)&&!x.hash}catch{return false}};

export default{async fetch(req,env){
  const url=new URL(req.url),path=url.pathname,m=req.method;
  const reqOrigin=req.headers.get('Origin');
  const cors={Vary:'Origin','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'};
  if(reqOrigin&&origins(env).includes(reqOrigin))cors['Access-Control-Allow-Origin']=reqOrigin;
  const J=(o,s=200,h={})=>new Response(JSON.stringify(o),{status:s,headers:{...cors,...h,'Content-Type':'application/json'}});
  const go=(to,h={})=>new Response(null,{status:302,headers:{Location:to,...h}});
  if(m==='OPTIONS')return new Response(null,{headers:cors});

  // ───────── 소셜 로그인 ─────────
  let r=path.match(/^\/auth\/(google|kakao)\/(start|callback)$/);
  if(r&&m==='GET'){
    const P=PROV[r[1]],redirect=`${url.origin}/auth/${r[1]}/callback`;
    if(r[2]==='start'){
      const ret=url.searchParams.get('return');
      if(!P.key(env)||!env.SESSION_SECRET)return J({error:'not_configured'},503);
      if(!okReturn(env,ret))return J({error:'return'},400);
      const n=tok(16),p=b64u(enc.encode(JSON.stringify({n,e:now()+600,r:ret})));
      const state=p+'.'+await hmac(env.SESSION_SECRET,p);
      const q=new URLSearchParams({client_id:P.key(env),redirect_uri:redirect,response_type:'code',scope:P.scope,state});
      return go(P.auth+'?'+q,{'Set-Cookie':`pb_n=${n}; Max-Age=600; Path=/auth; HttpOnly; Secure; SameSite=Lax`});
    }
    // callback
    const [p,sig]=String(url.searchParams.get('state')||'').split('.');
    if(!p||!sig||!same(sig,await hmac(env.SESSION_SECRET||'',p)))return J({error:'state'},400);
    let st;try{st=JSON.parse(dec.decode(unb64u(p)))}catch{return J({error:'state'},400)}
    const ck=(req.headers.get('Cookie')||'').match(/(?:^|;\s*)pb_n=([^;]+)/);
    if(st.e<now()||!ck||!same(ck[1],st.n)||!okReturn(env,st.r))return J({error:'state'},400);
    const clr={'Set-Cookie':'pb_n=; Max-Age=0; Path=/auth; HttpOnly; Secure; SameSite=Lax'};
    const fail=c=>go(st.r+'#error='+c,clr);
    const code=url.searchParams.get('code');
    if(!code)return fail('denied');
    const body=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirect,client_id:P.key(env)});
    if(P.secret(env))body.set('client_secret',P.secret(env));
    const tr=await fetch(P.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
    const tj=await tr.json().catch(()=>({}));
    if(!tr.ok||!tj.access_token)return fail('token');
    const ur=await fetch(P.me,{headers:{Authorization:'Bearer '+tj.access_token}});
    if(!ur.ok)return fail('profile');
    const u=P.user(await ur.json().catch(()=>({})));
    if(!u.pid)return fail('profile');
    const row=await env.DB.prepare('INSERT INTO users(provider,pid,name,created) VALUES(?,?,?,?) ON CONFLICT(provider,pid) DO UPDATE SET name=CASE WHEN length(excluded.name)>0 THEN excluded.name ELSE users.name END RETURNING id')
      .bind(r[1],u.pid,String(u.name||'').slice(0,60),now()).first();
    const c=tok(24);
    await env.DB.prepare('INSERT INTO logins(hash,user_id,exp) VALUES(?,?,?)').bind(await sha(c),row.id,now()+60).run();
    return go(st.r+'#code='+c,clr);
  }

  if(path==='/auth/exchange'&&m==='POST'){
    let b;try{b=await req.json()}catch{return J({error:'bad'},400)}
    if(typeof b.code!=='string'||b.code.length>100)return J({error:'code'},400);
    await env.DB.batch([env.DB.prepare('DELETE FROM logins WHERE exp<?').bind(now()),env.DB.prepare('DELETE FROM sessions WHERE exp<?').bind(now())]);
    const l=await env.DB.prepare('DELETE FROM logins WHERE hash=? AND exp>=? RETURNING user_id').bind(await sha(b.code),now()).first();
    if(!l)return J({error:'code'},401);
    const t=tok(32);
    await env.DB.prepare('INSERT INTO sessions(hash,user_id,exp) VALUES(?,?,?)').bind(await sha(t),l.user_id,now()+SESSION_DAYS*86400).run();
    const u=await env.DB.prepare('SELECT name FROM users WHERE id=?').bind(l.user_id).first();
    return J({token:t,user:{name:u.name}});
  }

  // ───────── 인증이 필요한 API ─────────
  const bearer=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');
  const me=bearer?await env.DB.prepare('SELECT u.id,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.exp>?').bind(await sha(bearer),now()).first():null;

  r=path.match(/^\/api\/plans\/([^/]+)(?:\/(share))?$/);
  const pid=r&&r[1];
  if(r&&!ID.test(pid))return J({error:'not_found'},404);

  if(path==='/auth/logout'&&m==='POST'){if(bearer)await env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(await sha(bearer)).run();return J({ok:true})}

  // 공유 링크로 읽기 전용 열람 (로그인 불필요)
  if(r&&!r[2]&&m==='GET'){
    const p=await env.DB.prepare('SELECT owner_id,data,share FROM plans WHERE id=?').bind(pid).first();
    const s=url.searchParams.get('s');
    if(p&&me&&p.owner_id===me.id)return J({data:JSON.parse(p.data),role:'owner',share:p.share});
    if(p&&p.share&&s&&same(s,p.share))return J({data:JSON.parse(p.data),role:'viewer'});
    return J({error:'not_found'},me?404:401);
  }

  if(!me)return J({error:'auth'},401);

  if(path==='/api/me'&&m==='GET')return J({user:{name:me.name}});

  if(path==='/api/plans'&&m==='GET'){
    const {results}=await env.DB.prepare('SELECT id,title,sub,start,cover,tpl,updated FROM plans WHERE owner_id=? ORDER BY updated DESC').bind(me.id).all();
    return J({plans:results});
  }

  const check=d=>d&&typeof d==='object'&&!Array.isArray(d)&&Array.isArray(d.days)&&JSON.stringify(d).length<=MAX;
  const sum=d=>[String(d.title||'').slice(0,200),String(d.sub||'').slice(0,200),String(d.start||'').slice(0,10),/^https?:\/\//.test(d.cover||'')?String(d.cover).slice(0,1000):'',Number.isInteger(+d.tpl)&&+d.tpl>=0&&+d.tpl<10?+d.tpl:0];

  if(path==='/api/plans'&&m==='POST'){
    let b;try{b=await req.json()}catch{return J({error:'bad'},400)}
    const d=b.data===undefined?{days:[]}:b.data;
    if(!check(d))return J({error:'data'},400);
    const c=await env.DB.prepare('SELECT COUNT(*) n FROM plans WHERE owner_id=?').bind(me.id).first();
    if(c.n>=MAXPLANS)return J({error:'limit'},400);
    const id=lid(12);
    await env.DB.prepare('INSERT INTO plans(id,owner_id,data,title,sub,start,cover,tpl,updated) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,me.id,JSON.stringify(d),...sum(d),now()).run();
    return J({id},201);
  }

  if(r){
    const p=await env.DB.prepare('SELECT owner_id,share FROM plans WHERE id=?').bind(pid).first();
    if(!p||p.owner_id!==me.id)return J({error:'not_found'},404);   // 남의 플랜북은 존재 여부도 알려주지 않는다
    if(!r[2]&&m==='PUT'){
      let b;try{b=await req.json()}catch{return J({error:'bad'},400)}
      if(!check(b.data))return J({error:'data'},400);
      await env.DB.prepare('UPDATE plans SET data=?,title=?,sub=?,start=?,cover=?,tpl=?,updated=? WHERE id=?').bind(JSON.stringify(b.data),...sum(b.data),now(),pid).run();
      return J({ok:true});
    }
    if(!r[2]&&m==='DELETE'){await env.DB.prepare('DELETE FROM plans WHERE id=?').bind(pid).run();return J({ok:true})}
    if(r[2]&&m==='POST'){
      let rot=false;try{rot=!!(await req.json()).rotate}catch{}
      const s=(!p.share||rot)?lid(24):p.share;
      await env.DB.prepare('UPDATE plans SET share=? WHERE id=?').bind(s,pid).run();
      return J({share:s});
    }
    if(r[2]&&m==='DELETE'){await env.DB.prepare('UPDATE plans SET share=NULL WHERE id=?').bind(pid).run();return J({share:null})}
  }
  return J({error:'not_found'},404);
}};
