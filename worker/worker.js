// Cloudflare Worker: 소셜 로그인(Google/Kakao) + 계정 연결 + 사용자별 플랜북 저장(D1) + 공유(링크/초대/구성원)
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
const ID=/^[a-z0-9]{12}$/,TK=/^[a-z0-9]{24}$/,MAX=300000,MAXPLANS=50,MAXMEMBERS=20,MAXINVITES=10,SESSION_DAYS=30;
const now=()=>Math.floor(Date.now()/1000);
// 외부 이미지는 받지 않고, 링크는 https 만 허용한다
const cleanUrl=u=>{const t=String(u||'');if(!t||t.length>500)return '';try{const x=new URL(t);return x.protocol==='https:'?x.href:''}catch{return ''}};
const clean=d=>{d.cover='';(d.days||[]).forEach(x=>{if(x&&typeof x==='object')delete x.img});if(Array.isArray(d.tickets))d.tickets.forEach(t=>{if(t&&typeof t==='object')t.url=cleanUrl(t.url)});return d};

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
      const cc=url.searchParams.get('cc')||'';
      if(!/^[A-Za-z0-9_-]{43}$/.test(cc))return J({error:'cc'},400);
      const n=tok(16),p=b64u(enc.encode(JSON.stringify({n,e:now()+600,r:ret,c:cc})));
      const state=p+'.'+await hmac(env.SESSION_SECRET,p);
      const q=new URLSearchParams({client_id:P.key(env),redirect_uri:redirect,response_type:'code',scope:P.scope,state});
      return go(P.auth+'?'+q,{'Set-Cookie':`pb_n=${n}; Max-Age=600; Path=/auth; HttpOnly; Secure; SameSite=Lax`});
    }
    // callback
    const [p,sig]=String(url.searchParams.get('state')||'').split('.');
    if(!p||!sig||!same(sig,await hmac(env.SESSION_SECRET||'',p)))return J({error:'state'},400);
    let st;try{st=JSON.parse(dec.decode(unb64u(p)))}catch{return J({error:'state'},400)}
    const ck=(req.headers.get('Cookie')||'').match(/(?:^|;\s*)pb_n=([^;]+)/);
    if(st.e<now()||!ck||!same(ck[1],st.n)||!okReturn(env,st.r)||!/^[A-Za-z0-9_-]{43}$/.test(st.c||''))return J({error:'state'},400);
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
    const nm=String(u.name||'').slice(0,60);
    let idn=await env.DB.prepare('SELECT id,user_id FROM identities WHERE provider=? AND pid=?').bind(r[1],u.pid).first();
    if(!idn){
      const nu=await env.DB.prepare("INSERT INTO users(provider,pid,name,created) VALUES('acct',?,?,?) RETURNING id").bind(lid(16),nm,now()).first();
      try{await env.DB.prepare('INSERT INTO identities(provider,pid,user_id,name,created) VALUES(?,?,?,?,?)').bind(r[1],u.pid,nu.id,nm,now()).run()}
      catch{await env.DB.prepare('DELETE FROM users WHERE id=?').bind(nu.id).run()}   // 동시에 처음 로그인한 경우
      idn=await env.DB.prepare('SELECT id,user_id FROM identities WHERE provider=? AND pid=?').bind(r[1],u.pid).first();
      if(!idn)return fail('profile');
    }else if(nm){
      await env.DB.batch([env.DB.prepare('UPDATE identities SET name=? WHERE id=?').bind(nm,idn.id),env.DB.prepare("UPDATE users SET name=? WHERE id=? AND name=''").bind(nm,idn.user_id)]);
    }
    const c=tok(24);
    await env.DB.prepare('INSERT INTO logins(hash,user_id,exp,cc) VALUES(?,?,?,?)').bind(await sha(c),idn.user_id,now()+60,st.c).run();
    return go(st.r+'#code='+c,clr);
  }

  if(path==='/auth/exchange'&&m==='POST'){
    let b;try{b=await req.json()}catch{return J({error:'bad'},400)}
    if(typeof b.code!=='string'||b.code.length>100||typeof b.cv!=='string'||!/^[A-Za-z0-9_-]{20,100}$/.test(b.cv))return J({error:'code'},400);
    await env.DB.batch([env.DB.prepare('DELETE FROM logins WHERE exp<?').bind(now()),env.DB.prepare('DELETE FROM sessions WHERE exp<?').bind(now())]);
    const l=await env.DB.prepare('DELETE FROM logins WHERE hash=? AND exp>=? AND cc=? RETURNING user_id').bind(await sha(b.code),now(),await sha(b.cv)).first();
    if(!l)return J({error:'code'},401);
    const t=tok(32);
    await env.DB.prepare('INSERT INTO sessions(hash,user_id,exp) VALUES(?,?,?)').bind(await sha(t),l.user_id,now()+SESSION_DAYS*86400).run();
    const u=await env.DB.prepare('SELECT name FROM users WHERE id=?').bind(l.user_id).first();
    return J({token:t,user:{name:u.name}});
  }

  // ───────── 인증이 필요한 API ─────────
  const bearer=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');
  const me=bearer?await env.DB.prepare('SELECT u.id,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.exp>?').bind(await sha(bearer),now()).first():null;
  const body=async()=>{try{return await req.json()}catch{return null}};

  if(path==='/auth/logout'&&m==='POST'){if(bearer)await env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(await sha(bearer)).run();return J({ok:true})}

  // 초대 링크 미리보기 (로그인 불필요, 토큰을 아는 사람만)
  r=path.match(/^\/api\/invites\/([a-z0-9]{24})(\/accept)?$/);
  if(r){
    const iv=await env.DB.prepare('SELECT i.plan_id,i.role,p.title,p.owner_id FROM plan_invites i JOIN plans p ON p.id=i.plan_id WHERE i.token=? AND (i.exp IS NULL OR i.exp>?)').bind(r[1],now()).first();
    if(!iv)return J({error:'invite'},404);
    if(!r[2]&&m==='GET')return J({title:iv.title,role:iv.role});
    if(r[2]&&m==='POST'){
      if(!me)return J({error:'auth'},401);
      if(iv.owner_id===me.id)return J({id:iv.plan_id,role:'owner'});
      const cur=await env.DB.prepare('SELECT role FROM plan_members WHERE plan_id=? AND user_id=?').bind(iv.plan_id,me.id).first();
      if(!cur){
        const c=await env.DB.prepare('SELECT COUNT(*) n FROM plan_members WHERE plan_id=?').bind(iv.plan_id).first();
        if(c.n>=MAXMEMBERS)return J({error:'limit'},400);
        await env.DB.prepare('INSERT INTO plan_members(plan_id,user_id,role,added) VALUES(?,?,?,?)').bind(iv.plan_id,me.id,iv.role,now()).run();
        return J({id:iv.plan_id,role:iv.role});
      }
      if(cur.role==='viewer'&&iv.role==='editor')await env.DB.prepare('UPDATE plan_members SET role=? WHERE plan_id=? AND user_id=?').bind('editor',iv.plan_id,me.id).run();
      return J({id:iv.plan_id,role:cur.role==='editor'?'editor':iv.role});
    }
    return J({error:'not_found'},404);
  }

  r=path.match(/^\/api\/plans\/([^/]+)(?:\/(sharing|members|invites)(?:\/([^/]+))?)?$/);
  const pid=r&&r[1],sub=r&&r[2],subid=r&&r[3];
  if(r&&!ID.test(pid))return J({error:'not_found'},404);
  const isPlanGet=r&&!sub&&m==='GET';
  if(!me&&!isPlanGet)return J({error:'auth'},401);

  if(path==='/api/me'&&m==='GET'){
    const ids=(await env.DB.prepare('SELECT id,provider,name FROM identities WHERE user_id=? ORDER BY id').bind(me.id).all()).results;
    return J({user:{id:me.id,name:me.name},identities:ids});
  }
  if(path==='/api/me'&&m==='DELETE'){
    const b=await body();if(!b||b.confirm!==true)return J({error:'confirm'},400);
    const own="(SELECT id FROM plans WHERE owner_id=?)",q=(x,...a)=>env.DB.prepare(x).bind(...a);
    await env.DB.batch([
      q('DELETE FROM plan_members WHERE plan_id IN '+own,me.id),q('DELETE FROM plan_invites WHERE plan_id IN '+own,me.id),
      q('DELETE FROM plans WHERE owner_id=?',me.id),q('DELETE FROM plan_members WHERE user_id=?',me.id),
      q('DELETE FROM sessions WHERE user_id=?',me.id),q('DELETE FROM logins WHERE user_id=?',me.id),
      q('DELETE FROM identities WHERE user_id=?',me.id),q('DELETE FROM users WHERE id=?',me.id)]);
    return J({ok:true});
  }
  const ri=path.match(/^\/api\/identities\/(\d+)$/);
  if(ri&&m==='DELETE'){
    const c=await env.DB.prepare('SELECT COUNT(*) n FROM identities WHERE user_id=?').bind(me.id).first();
    if(c.n<2)return J({error:'last'},400);                       // 마지막 로그인 수단은 해제할 수 없다
    const d=await env.DB.prepare('DELETE FROM identities WHERE id=? AND user_id=?').bind(+ri[1],me.id).run();
    return d.meta.changes?J({ok:true}):J({error:'not_found'},404);
  }
  // 계정 연결: 소셜 로그인으로 받은 1회용 코드를 "지금 로그인한 계정"에 붙인다 (코드를 요청한 브라우저 + 로그인 상태 둘 다 필요)
  if((path==='/api/link/preview'||path==='/api/link')&&m==='POST'){
    const b=await body();if(!b||typeof b.code!=='string'||typeof b.cv!=='string'||!/^[A-Za-z0-9_-]{20,100}$/.test(b.cv))return J({error:'bad'},400);
    const hc=await sha(b.code),hv=await sha(b.cv);
    const l=await env.DB.prepare('SELECT user_id FROM logins WHERE hash=? AND exp>? AND cc=?').bind(hc,now(),hv).first();
    if(!l)return J({error:'code'},401);
    const U=l.user_id,T=me.id;
    const st=U===T?null:{
      plans:(await env.DB.prepare('SELECT COUNT(*) n FROM plans WHERE owner_id=?').bind(U).first()).n,
      shared:(await env.DB.prepare('SELECT COUNT(*) n FROM plan_members WHERE user_id=?').bind(U).first()).n,
      mine:(await env.DB.prepare('SELECT COUNT(*) n FROM plans WHERE owner_id=?').bind(T).first()).n,
      provider:(await env.DB.prepare('SELECT provider FROM identities WHERE user_id=? ORDER BY id').bind(U).all()).results.map(x=>x.provider)};
    if(path==='/api/link/preview'){
      await env.DB.prepare('UPDATE logins SET exp=? WHERE hash=? AND exp<?').bind(now()+600,hc,now()+600).run();   // 확인하는 동안 코드가 만료되지 않게
      return J(U===T?{same:true}:{same:false,plans:st.plans,shared:st.shared,providers:st.provider});
    }
    if(U===T){await env.DB.prepare('DELETE FROM logins WHERE hash=?').bind(hc).run();return J({ok:true,merged:false})}
    const empty=st.plans===0&&st.shared===0;
    if(!empty&&b.merge!==true)return J({error:'merge_required',plans:st.plans,shared:st.shared},409);
    if(st.mine+st.plans>MAXPLANS)return J({error:'limit'},400);
    const del=await env.DB.prepare('DELETE FROM logins WHERE hash=? AND exp>? AND cc=?').bind(hc,now(),hv).run();
    if(!del.meta.changes)return J({error:'code'},401);
    const q=(x,...a)=>env.DB.prepare(x).bind(...a);
    await env.DB.batch([
      q('UPDATE identities SET user_id=? WHERE user_id=?',T,U),
      q('UPDATE plans SET owner_id=? WHERE owner_id=?',T,U),
      q('DELETE FROM plan_members WHERE user_id=? AND plan_id IN (SELECT plan_id FROM plan_members WHERE user_id=?)',U,T),
      q('UPDATE plan_members SET user_id=? WHERE user_id=?',T,U),
      q('DELETE FROM plan_members WHERE user_id=? AND plan_id IN (SELECT id FROM plans WHERE owner_id=?)',T,T),
      q('DELETE FROM sessions WHERE user_id=?',U),q('DELETE FROM logins WHERE user_id=?',U),
      q("UPDATE users SET name=(SELECT name FROM users WHERE id=?) WHERE id=? AND name=''",U,T),
      q('DELETE FROM users WHERE id=?',U)]);
    return J({ok:true,merged:!empty});
  }

  const check=d=>d&&typeof d==='object'&&!Array.isArray(d)&&Array.isArray(d.days)&&JSON.stringify(d).length<=MAX;
  const sum=d=>[String(d.title||'').slice(0,200),String(d.sub||'').slice(0,200),String(d.start||'').slice(0,10),Number.isInteger(+d.tpl)&&+d.tpl>=0&&+d.tpl<10?+d.tpl:0];

  if(path==='/api/plans'&&m==='GET'){
    const mine=await env.DB.prepare('SELECT id,title,sub,start,tpl,updated,access FROM plans WHERE owner_id=? ORDER BY updated DESC').bind(me.id).all();
    const shared=await env.DB.prepare('SELECT p.id,p.title,p.sub,p.start,p.tpl,p.updated,m.role FROM plan_members m JOIN plans p ON p.id=m.plan_id WHERE m.user_id=? ORDER BY p.updated DESC').bind(me.id).all();
    return J({plans:mine.results,shared:shared.results});
  }
  if(path==='/api/plans'&&m==='POST'){
    const b=await body();if(!b)return J({error:'bad'},400);
    const d=b.data===undefined?{days:[]}:b.data;
    if(!check(d))return J({error:'data'},400);
    clean(d);
    const c=await env.DB.prepare('SELECT COUNT(*) n FROM plans WHERE owner_id=?').bind(me.id).first();
    if(c.n>=MAXPLANS)return J({error:'limit'},400);
    const id=lid(12);
    await env.DB.prepare("INSERT INTO plans(id,owner_id,data,title,sub,start,cover,tpl,updated) VALUES(?,?,?,?,?,?,'',?,?)").bind(id,me.id,JSON.stringify(d),...sum(d),now()).run();
    return J({id},201);
  }
  if(!r)return J({error:'not_found'},404);

  // 이 플랜북에 대한 내 권한: owner > editor > viewer
  const p=await env.DB.prepare('SELECT id,owner_id,data,access,share,rev FROM plans WHERE id=?').bind(pid).first();
  const s=url.searchParams.get('s');
  let role=null;
  if(p){
    if(me&&p.owner_id===me.id)role='owner';
    else{
      if(me){const mm=await env.DB.prepare('SELECT role FROM plan_members WHERE plan_id=? AND user_id=?').bind(pid,me.id).first();if(mm)role=mm.role}
      if(s&&p.share&&p.access!=='private'&&same(s,p.share)){
        const lr=(p.access==='edit'&&me)?'editor':'viewer';
        if(role!=='editor')role=lr;
      }
    }
  }
  if(!role)return J({error:'not_found'},me?404:401);
  const canEdit=role==='owner'||role==='editor';

  if(!sub){
    if(m==='GET'){
      const out={data:JSON.parse(p.data),role,rev:p.rev};
      if(role==='owner'){
        out.access=p.access;out.share=p.share;
        out.members=(await env.DB.prepare('SELECT m.user_id id,u.name,u.provider,m.role FROM plan_members m JOIN users u ON u.id=m.user_id WHERE m.plan_id=? ORDER BY m.added').bind(pid).all()).results;
        out.invites=(await env.DB.prepare('SELECT token,role,exp FROM plan_invites WHERE plan_id=? AND (exp IS NULL OR exp>?) ORDER BY created').bind(pid,now()).all()).results;
      }else if(role==='viewer'&&!me&&p.access==='edit')out.login_to_edit=true;
      return J(out);
    }
    if(m==='PUT'){
      if(!canEdit)return J({error:'forbidden'},403);
      const b=await body();if(!b||!check(b.data))return J({error:'data'},400);
      if(!Number.isInteger(b.rev))return J({error:'rev'},400);
      clean(b.data);
      const u=await env.DB.prepare('UPDATE plans SET data=?,title=?,sub=?,start=?,tpl=?,updated=?,rev=rev+1 WHERE id=? AND rev=?').bind(JSON.stringify(b.data),...sum(b.data),now(),pid,b.rev).run();
      if(!u.meta.changes){const c=await env.DB.prepare('SELECT data,rev FROM plans WHERE id=?').bind(pid).first();return J({error:'conflict',rev:c.rev,data:JSON.parse(c.data)},409)}
      return J({ok:true,rev:b.rev+1});
    }
    if(m==='DELETE'){if(role!=='owner')return J({error:'forbidden'},403);await env.DB.prepare('DELETE FROM plans WHERE id=?').bind(pid).run();return J({ok:true})}
    return J({error:'not_found'},404);
  }

  // 공유 설정은 소유자만 (단, 구성원 본인의 "나가기"는 허용)
  if(sub==='members'&&m==='DELETE'&&subid==='me'){
    if(role==='owner')return J({error:'forbidden'},403);
    await env.DB.prepare('DELETE FROM plan_members WHERE plan_id=? AND user_id=?').bind(pid,me.id).run();
    return J({ok:true});
  }
  if(role!=='owner')return J({error:'forbidden'},403);

  if(sub==='sharing'&&m==='PUT'){
    const b=await body();if(!b||!['private','view','edit'].includes(b.access))return J({error:'data'},400);
    let tk=p.share;
    if((b.access!=='private'&&(!tk||p.access==='private'))||b.rotate)tk=lid(24);
    await env.DB.prepare('UPDATE plans SET access=?,share=? WHERE id=?').bind(b.access,tk,pid).run();
    return J({access:b.access,share:tk});
  }
  if(sub==='members'&&subid&&/^\d+$/.test(subid)){
    if(m==='PUT'){
      const b=await body();if(!b||!['viewer','editor'].includes(b.role))return J({error:'data'},400);
      await env.DB.prepare('UPDATE plan_members SET role=? WHERE plan_id=? AND user_id=?').bind(b.role,pid,+subid).run();
      return J({ok:true});
    }
    if(m==='DELETE'){await env.DB.prepare('DELETE FROM plan_members WHERE plan_id=? AND user_id=?').bind(pid,+subid).run();return J({ok:true})}
  }
  if(sub==='invites'&&!subid&&m==='POST'){
    const b=await body();if(!b||!['viewer','editor'].includes(b.role)||![0,1,7,30].includes(b.days))return J({error:'data'},400);
    const c=await env.DB.prepare('SELECT COUNT(*) n FROM plan_invites WHERE plan_id=? AND (exp IS NULL OR exp>?)').bind(pid,now()).first();
    if(c.n>=MAXINVITES)return J({error:'limit'},400);
    const tk=lid(24),exp=b.days?now()+b.days*86400:null;
    await env.DB.prepare('INSERT INTO plan_invites(token,plan_id,role,exp,created) VALUES(?,?,?,?,?)').bind(tk,pid,b.role,exp,now()).run();
    return J({token:tk,role:b.role,exp},201);
  }
  if(sub==='invites'&&subid&&TK.test(subid)&&m==='DELETE'){
    await env.DB.prepare('DELETE FROM plan_invites WHERE token=? AND plan_id=?').bind(subid,pid).run();
    return J({ok:true});
  }
  return J({error:'not_found'},404);
}};
