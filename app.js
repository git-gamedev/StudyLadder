const $=s=>document.querySelector(s),V=$('#v');let S=null,lv=0,Q={},F={},G={},L={2:12,3:20,4:20};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const sh=a=>{a=[...a];for(let i=a.length;i>1;i--){const j=Math.random()*i|0;[a[i-1],a[j]]=[a[j],a[i-1]]}return a};
const norm=s=>String(s).toLowerCase().replace(/\(.*?\)/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\b(the|a|an)\b/g,'').replace(/\b1\b/g,'i').replace(/\b2\b/g,'ii').replace(/\s+/g,' ').trim();
function lev(a,b){const d=[...Array(b.length+1).keys()];for(let i=1;i<=a.length;i++){let p=d[0];d[0]=i;for(let j=1;j<=b.length;j++){const t=d[j];d[j]=Math.min(d[j]+1,d[j-1]+1,p+(a[i-1]==b[j-1]?0:1));p=t}}return d[b.length]}
const forms=t=>[t.term,...(t.aliases||[])].map(norm);
const same=(a,b)=>a==b||a.replace(/ /g,'')==b.replace(/ /g,'');
const sig=s=>(s.match(/\d+|\b(?:i|ii|iii|iv)\b/g)||[]).join(',');
/* Exact match wins. A typo is only forgiven if it is not exactly another term (G1 vs G2, BRCA1 vs BRCA2)
   and keeps the same numerals (Prophase vs Prophase I). */
const ok=(v,t)=>{const n=norm(v);if(!n)return false;const F=forms(t);
if(F.some(f=>same(f,n)))return true;
if(S&&S.all.some(x=>x!==t&&forms(x).some(f=>same(f,n))))return false;
return F.some(f=>f.length>=5&&sig(f)==sig(n)&&lev(f,n)<=(f.length>9?2:1))};
const rx=x=>x.replace(/[.*+?^$()|[\]\\{}]/g,'\\$&');
const mask=t=>{let s=t.definition;const v=new Set([t.term,t.term.replace(/\s*\(.*?\)/g,'').trim(),...(t.aliases||[]).filter(a=>a.length>=5)]);
[...v].filter(Boolean).sort((a,b)=>b.length-a.length).forEach(x=>{s=s.replace(new RegExp('(?<![A-Za-z0-9])'+rx(x)+'(?![A-Za-z0-9])','gi'),'_____')});return esc(s)};
const decoys=(t,n)=>{const src=S.pool.length>=6?S.pool:S.all,f=forms(t),o=src.filter(x=>x!==t&&!forms(x).some(y=>f.includes(y)));return[...sh(o.filter(x=>x.category==t.category)),...sh(o.filter(x=>x.category!=t.category))].slice(0,n)};

let LIB=[];const KEY='studyladder.library.v1';
function loadLib(){try{LIB=JSON.parse(localStorage.getItem(KEY));if(!Array.isArray(LIB))LIB=[]}catch(e){LIB=[]}}
function save(){try{localStorage.setItem(KEY,JSON.stringify(LIB));return 1}catch(e){return 0}}
function nav(){$('#sub').textContent=S?S.title:'Upload a study JSON to build your four practice levels.';$('#nav').innerHTML=['Setup','1 Flashcards','2 Shooter','3 Multiple choice','4 Free response'].map((n,i)=>`<button class="${i==lv?'on':''}" ${S||i==0?'':'disabled'} onclick="go(${i})">${n}</button>`).join('')}
function go(l){document.body.classList.toggle('wide',l==2);G.run=false;cancelAnimationFrame(G.raf);lv=l;nav();l>=2?intro(l):[setup,flash][l]()}
const NM={2:'Level 2: Shooter',3:'Level 3: Multiple choice',4:'Level 4: Free response'};
function intro(l){const n=S.pool.length;L[l]=Math.max(1,Math.min(L[l],n));const o=[5,10,15,20,30,50].filter(x=>x<n).concat(n);
V.innerHTML=`<div class="q"><h2>${NM[l]}</h2><p class="mute">How many ${l==2?'ships':'questions'} do you want? (${n} terms available)</p><div class="chips">${o.map(x=>`<button class="chip ${L[l]==x?'on':''}" onclick="sl(${l},${x})">${x==n?'All ('+n+')':x}</button>`).join('')}</div><div class="row"><label>Custom: <input type="number" id="ln" min="1" max="${n}" value="${L[l]}" onchange="sl(${l},this.value)" style="width:5em"></label></div><div class="row"><button class="pri" onclick="[0,0,shoot,mcq,free][${l}]()">Start (${L[l]})</button></div></div>`}
function sl(l,x){L[l]=Math.max(1,Math.min(+x||1,S.pool.length));intro(l)}
function setup(){V.innerHTML=`<div class="drop" id="dz"><p><b>Drop one or more study JSON files here</b></p><p class="mute">Format: {"title": "...", "terms": [{"term", "definition", "category", "aliases"}]}. Only <code>term</code> and <code>definition</code> are required.</p><input type="file" id="fi" accept=".json,application/json" multiple aria-label="Choose JSON files"><p class="err" id="er"></p></div><div class="q"><h2>No JSON yet?</h2><p class="mute">Download the prompt, give it to any AI together with your notes, and save the JSON it returns.</p><button id="pd" type="button">Download AI prompt (.txt)</button></div><div id="lib"></div><div id="info"></div>`;$('#pd').onclick=dlPrompt;
const dz=$('#dz');dz.ondragover=e=>{e.preventDefault();dz.classList.add('over')};dz.ondragleave=()=>dz.classList.remove('over');
dz.ondrop=e=>{e.preventDefault();dz.classList.remove('over');rd(e.dataTransfer.files)};$('#fi').onchange=e=>rd(e.target.files);lib();info()}
const PROMPT="You are helping me build a study set for a practice website called Study Ladder. The site only accepts one specific JSON format. Turn my study materials into that format exactly.\n\n=== WHAT I WILL GIVE YOU ===\nMy study materials (notes, textbook text, slides, a study guide, a vocabulary list, etc.) will be pasted or attached after this prompt. If I have not provided any yet, reply only with: \"Please paste or attach your study materials.\" and wait.\n\n=== WHAT YOU MUST OUTPUT ===\nOutput ONLY one valid JSON object. No introduction, no explanation, no notes after it. If you can, put it in a single code block or file so I can copy or save it as a .json file.\n\nThe JSON must have this exact shape:\n\n{\n  \"title\": \"Short name of the test or unit\",\n  \"terms\": [\n    {\n      \"id\": \"a1\",\n      \"term\": \"Mitosis\",\n      \"definition\": \"Nuclear division that produces two genetically identical daughter nuclei; used for growth and repair.\",\n      \"category\": \"Cell Division\",\n      \"aliases\": [\"mitotic division\"]\n    }\n  ]\n}\n\nField rules:\n- \"title\": string. A short name for the study set.\n- \"terms\": array. At least 5 entries; aim for every testable idea in my materials (30 or more if the materials are large).\n- \"id\": string, unique for every entry (for example a short category prefix plus a number: \"m1\", \"m2\", \"c1\").\n- \"term\": REQUIRED string. The word, name, or short concept label the student must be able to recall. Keep it short (usually 1 to 5 words). Every term must be unique.\n- \"definition\": REQUIRED string. A clear, complete, self-contained explanation of the term, written from my materials. 1 to 3 sentences. It must make sense on its own with no other context.\n- \"category\": string. The unit, chapter, or topic the term belongs to. Use a small number of consistent category names (about 2 to 8 in total), spelled identically every time. Students can pick which categories to study.\n- \"aliases\": optional array of strings. Other answers a student could type and still be correct: abbreviations, plurals, common alternate names, the spelled-out form of an acronym, or the term without a leading word. Leave it out or use [] if there are none.\n\n=== QUALITY RULES (important, the games depend on these) ===\n1. The tests show the definition and ask the student to type or pick the term, so the definition must NOT contain the term itself or any of its aliases. Rephrase the definition if needed. (Bad: \"Mitosis is the process of mitosis in which...\". Good: \"Nuclear division that produces two identical daughter nuclei.\")\n2. One idea per entry. Split lists into separate entries when each item can be tested on its own (for example each phase of a process gets its own term).\n3. Similar terms need clearly different definitions. If there are numbered or related items (Phase I vs Phase II, Type 1 vs Type 2, G1 vs G2), write each definition so only one term fits it, and say what makes it different (order, location, result, purpose).\n4. Never put one term as an alias of a different term, and never repeat the same term twice.\n5. Use only facts from my materials. Do not invent information. If something in my materials is unclear or contradictory, skip it or keep my wording rather than guessing.\n6. Definitions should be answerable from memory: include the key facts a test would ask for (numbers, names, purposes, steps, causes) but not paragraphs of background.\n7. Keep wording plain and accurate. No markdown, no bullet characters, and no line breaks inside strings.\n\n=== JSON VALIDITY RULES ===\n- Use double quotes for all keys and strings. No single quotes.\n- Escape any double quote inside a string as \\\" and any backslash as \\\\.\n- No trailing commas. No comments. No text outside the JSON object.\n- The file must pass a strict JSON parser. Double check brackets and commas before you answer.\n\n=== BEFORE YOU ANSWER, CHECK ===\n- Every entry has a non-empty \"term\" and \"definition\".\n- No definition contains its own term or aliases.\n- All \"id\" values and all \"term\" values are unique.\n- Category names are consistent.\n- The output is a single JSON object and nothing else.\n\nIf my materials are too long to finish in one reply, output a complete valid JSON object for the first part, then tell me to say \"continue\" and give the next part as a separate complete JSON object with the same title and categories and ids that keep counting up, so I can merge the \"terms\" arrays.\n\nMy study materials start below this line:\n------------------------------------------------------------\n";
function dlPrompt(){const a=document.createElement('a'),u=URL.createObjectURL(new Blob([PROMPT],{type:'text/plain'}));a.href=u;a.download='study-ladder-json-prompt.txt';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)}
/* Library: every uploaded set is kept in localStorage; any mix of sets can be ticked to build one combined test. */
function add(txt,name){const j=JSON.parse(txt);let a=Array.isArray(j)?j:j.terms;if(!Array.isArray(a))throw'Expected a "terms" array.';
a=a.filter(t=>t&&t.term&&t.definition).map(t=>({...t,category:t.category||'General'}));if(a.length<5)throw'Need at least 5 entries that have both "term" and "definition".';
const h=[...txt].reduce((h,c)=>(h*31+c.charCodeAt(0))|0,0)+'_'+txt.length;if(LIB.some(x=>x.h==h))return'already in your library.';
LIB.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),title:j.title||name.replace(/\.json$/i,'')||'Study set',terms:a,sel:true,h})}
async function rd(fs){const er=[];for(const f of fs){try{const m=add(await f.text(),f.name);if(m)er.push(f.name+' is '+m)}catch(e){er.push(f.name+': '+(e.message||e))}}
if(!refresh())er.push('Could not save to this browser (storage full or blocked), so these sets will be lost when you leave.');$('#er').textContent=er.join(' ');const fi=$('#fi');if(fi)fi.value=''}
function buildS(){const sel=LIB.filter(x=>x.sel);if(!sel.length){S=null;return}const m=new Map();sel.forEach(x=>x.terms.forEach(t=>{const k=norm(t.term);if(!m.has(k))m.set(k,t)}));const a=[...m.values()];
S={title:sel.length==1?sel[0].title:sel.length+' study sets',all:a,cats:new Set(a.map(t=>t.category)),df:{}};a.forEach(t=>new Set(toks(t.definition).map(x=>x.w.toLowerCase())).forEach(w=>S.df[w]=(S.df[w]||0)+1));pl()}
function refresh(){const ok=save();buildS();nav();lib();info();return ok}
function lib(){$('#lib').innerHTML=LIB.length?`<div class="q"><h2>Your study sets</h2><p class="mute">Saved in this browser. Tick one set, several, or all to practice with them combined.</p>${LIB.map(x=>`<div class="set"><label><input type="checkbox" ${x.sel?'checked':''} onchange="ts('${x.id}',this.checked)"> <b>${esc(x.title)}</b> <span class="mute">(${x.terms.length} terms)</span></label><button type="button" onclick="rm('${x.id}')" aria-label="Delete ${esc(x.title)}">Delete</button></div>`).join('')}<div class="row"><button onclick="sa(1)">Select all</button><button onclick="sa(0)">Select none</button></div></div>`:''}
function ts(id,on){LIB.find(x=>x.id==id).sel=on;refresh()}
function sa(on){LIB.forEach(x=>x.sel=!!on);refresh()}
function rm(id){const x=LIB.find(y=>y.id==id);if(x&&confirm('Delete "'+x.title+'" from your library?')){LIB=LIB.filter(y=>y!=x);refresh()}}
const pl=()=>S.pool=S.all.filter(t=>S.cats.has(t.category));
function info(){if(!S){$('#info').innerHTML='';return}const cs=[...new Set(S.all.map(t=>t.category))];
$('#info').innerHTML=`<div class="q"><h2>${esc(S.title)}</h2><p>${S.pool.length} of ${S.all.length} terms selected. Choose what to study:</p><div class="cats">${cs.map(c=>`<label><input type="checkbox" ${S.cats.has(c)?'checked':''} onchange="tc('${esc(c).replace(/'/g,"\\'")}',this.checked)"> ${esc(c)} (${S.all.filter(t=>t.category==c).length})</label>`).join('')}</div><button class="pri" ${S.pool.length<5?'disabled':''} onclick="go(1)">Start with flashcards</button> ${S.pool.length<5?'<span class="err">Select at least 5 terms.</span>':''}</div>`}
function tc(c,on){on?S.cats.add(c):S.cats.delete(c);pl();info()}

/* Level 1 */
function flash(){F={d:sh(S.pool),i:0,b:false};fr()}
function fr(){const t=F.d[F.i];V.innerHTML=`<div class="flip ${F.b?'b':''}" onclick="F.b=!F.b;fr()" tabindex="0" role="button" aria-label="Flip card"><div class="in"><div class="f"><b>${esc(t.term)}</b><span class="tag">${esc(t.category)} · click to flip</span></div><div class="f bk">${esc(t.definition)}</div></div></div>
<div class="row"><button onclick="fn(-1)" ${F.i?'':'disabled'}>Previous</button><span class="mute">${F.i+1} / ${F.d.length}</span><button class="pri" onclick="fn(1)" ${F.i<F.d.length-1?'':'disabled'}>Next</button></div><div class="row"><button onclick="flash()">Shuffle again</button><button onclick="go(2)">Level 2</button></div>`}
function fn(d){F.i+=d;F.b=false;fr()}
document.addEventListener('keydown',e=>{if(lv!=1||e.target.tagName=='INPUT')return;if(e.key=='ArrowRight'&&F.i<F.d.length-1)fn(1);if(e.key=='ArrowLeft'&&F.i>0)fn(-1);if(e.key==' '){e.preventDefault();F.b=!F.b;fr()}});

/* shared results */
function done(title,right,total,miss,next){const pct=Math.round(100*right/total);V.innerHTML=`<div class="q"><h2>${title}</h2><p><b>${right} / ${total}</b> (${pct}%)</p>${miss.length?'<p>Review these:</p>'+miss.map(m=>`<p><b>${esc(m.term)}</b><br><span class="mute">${esc(m.definition)}</span></p>`).join(''):'<p>Perfect run.</p>'}<div class="row"><button class="pri" onclick="go(lv)">Play again</button>${next?`<button onclick="go(${lv+1})">Next level</button>`:''}</div></div>`}

/* Level 2: mothership launches drones that flock (boids) toward the player. Time is the pressure. */
function shoot(){G={q:sh(S.pool).slice(0,L[2]),i:0,score:0,lives:3,miss:[]};ship()}
const hearts=()=>'♥'.repeat(G.lives)+'♡'.repeat(3-G.lives);
function ship(){const t=G.q[G.i];Object.assign(G,{t,busy:false,run:true,m:1+.1*G.i,d:[],pend:sh([{t,c:1},...decoys(t,4).map(x=>({t:x}))])});sr();const A=$('.arena');G.W=A.clientWidth;G.H=A.clientHeight;G.v=(G.H-110)/20;G.wait=5;G.last=performance.now();G.raf=requestAnimationFrame(tick)}
function sr(){V.innerHTML=`<div class="hud"><span>Round ${G.i+1} / ${G.q.length} · Score ${G.score}</span><span>Speed ×${G.m.toFixed(1)} · <span class="lives" id="lv" aria-label="lives">${hearts()}</span></span></div><div class="bar"><i style="width:${100*G.i/G.q.length}%"></i></div><div class="q"><b>Type the term on the right drone:</b><p>${mask(G.t)}</p></div>
<div class="arena"><div class="stars s1"></div><div class="stars s2"></div><div class="planet"></div><div class="beam" id="bm"></div><div class="mother"><div class="dome"></div><div class="hull"></div><div class="lights"><i></i><i></i><i></i><i></i><i></i></div></div><div class="cd" id="cdw"><small>Launching in</small><b id="cd">5</b></div><div class="gun"><i class="barrel"></i><i class="base"></i></div></div>
<form onsubmit="return fire()" class="row" style="margin-bottom:0"><input type="text" id="ty" autocomplete="off" placeholder="Type a term and press Enter" aria-label="Your answer"><button class="pri">Fire</button></form><p id="ms" class="mute">You get 5 seconds to read the question, then the whole wave launches at once. Wrong drones shrug off your shots, so find the right one and shoot it to wipe out the wave. Every drone that reaches you costs a life (3 lives), and every round is faster.</p>`;$('#ty').focus()}
function spawn(d,k){const e=document.createElement('div');e.className='drone';e.textContent=d.t.term;$('.arena').appendChild(e);Object.assign(d,{el:e,w:e.offsetWidth,h:e.offsetHeight,px:G.W/2+(k-2)*55,py:80,vx:(k-2)*G.v*.6,vy:G.v*.5});G.d.push(d)}
/* boids: separation + alignment + cohesion + seek(player), then a hard no-overlap pass */
function steer(dt){const D=G.d,sp=G.v*G.m,gx=G.W/2,gy=G.H-30;
D.forEach(a=>{let sx=0,sy=0,vx=0,vy=0,cx=0,cy=0,n=0;
D.forEach(b=>{if(a==b)return;const dx=a.px-b.px,dy=a.py-b.py,rx=(a.w+b.w)/2+14,ry=(a.h+b.h)/2+14,nd=Math.hypot(dx/rx,dy/ry)||.01;
if(nd<1.7){const f=(1.7-nd)/nd;sx+=dx/rx*f;sy+=dy/ry*f}
if(Math.hypot(dx,dy)<180){vx+=b.vx;vy+=b.vy;cx+=b.px;cy+=b.py;n++}});
const tx=gx-a.px,ty=gy-a.py,l=Math.hypot(tx,ty)||1;let ax=(tx/l*sp-a.vx)*1.2+sx*120,ay=(ty/l*sp-a.vy)*1.2+sy*120;
if(n){ax+=(vx/n-a.vx)*.5+(cx/n-a.px)*.05;ay+=(vy/n-a.vy)*.5+(cy/n-a.py)*.05}a.ax=ax;a.ay=ay});
D.forEach(a=>{a.vx+=a.ax*dt;a.vy+=a.ay*dt;const s=Math.hypot(a.vx,a.vy);if(s>sp*1.15){a.vx*=sp*1.15/s;a.vy*=sp*1.15/s}a.px+=a.vx*dt;a.py+=a.vy*dt});
for(let k=0;k<3;k++){for(let i=0;i<D.length;i++)for(let j=i+1;j<D.length;j++){const a=D[i],b=D[j],dx=a.px-b.px,dy=a.py-b.py,ox=(a.w+b.w)/2+8-Math.abs(dx),oy=(a.h+b.h)/2+8-Math.abs(dy);
if(ox>0&&oy>0){if(ox<oy){const s=(dx<0?-1:1)*ox/2;a.px+=s;b.px-=s}else{const s=(dy<0?-1:1)*oy/2;a.py+=s;b.py-=s}}}
D.forEach(a=>{a.px=Math.max(a.w/2,Math.min(G.W-a.w/2,a.px));a.py=Math.max(a.h/2+60,a.py)})}}
function tick(now){if(!G.run)return;const dt=Math.min(.05,(now-G.last)/1000);G.last=now;if(G.wait>0){G.wait-=dt;if(G.wait<=0){$('#cdw').remove();G.pend.forEach(spawn);G.pend=[]}else $('#cd').textContent=Math.ceil(G.wait);G.raf=requestAnimationFrame(tick);return}steer(dt);const gx=G.W/2,gy=G.H-30;
G.d.forEach(d=>d.el.style.translate=`${d.px-d.w/2}px ${d.py-d.h/2}px`);
for(const d of G.d.slice())if(Math.hypot(d.px-gx,d.py-gy)<d.w/2+22&&hit(d))return;G.raf=requestAnimationFrame(tick)}
/* a drone reaching the player costs a life; if it carried the answer the round is lost; 0 lives = game over */
function hit(d){G.d=G.d.filter(x=>x!=d);d.el.classList.add('boom');setTimeout(()=>d.el.remove(),600);G.lives--;$('#lv').textContent=hearts();const A=$('.arena');A.classList.remove('breach');void A.offsetWidth;A.classList.add('breach');if(d.c)G.miss.push(G.t);
if(G.lives<=0){G.run=false;G.busy=true;if(!d.c)G.miss.push(G.t);setTimeout(()=>done('Game over — answer was “'+esc(G.t.term)+'”',G.score,G.q.length,G.miss,false),1200);return 1}
if(d.c){G.run=false;G.busy=true;$('#ms').innerHTML='The drone with the answer reached you! It was <b>'+esc(G.t.term)+'</b>.';setTimeout(nr,1600);return 1}return 0}
function nr(){G.i++;G.i>=G.q.length?done('Mission complete',G.score,G.q.length,G.miss,true):ship()}
function laser(good,d){const A=$('.arena').getBoundingClientRect(),g=$('.gun').getBoundingClientRect(),b=$('#bm');
const x1=g.left+g.width/2-A.left,y1=g.bottom-12-A.top,len=Math.hypot(d.px-x1,d.py-y1),ang=Math.atan2(d.px-x1,y1-d.py)*180/Math.PI;
b.style.cssText=`left:${x1-2}px;top:${y1-len}px;height:${len}px;transform:rotate(${ang}deg)`;b.className='beam';void b.offsetWidth;b.className='beam on'+(good?'':' bad');$('.barrel').style.transform=`rotate(${ang}deg)`;setTimeout(()=>{b.className='beam';$('.barrel').style.transform=''},280)}
function fire(){if(G.busy)return false;const inp=$('#ty'),v=inp.value,c=G.d.find(d=>d.c);
if(ok(v,G.t)){if(!c){$('#ms').textContent='That target has not launched yet.';return false}
G.busy=true;G.run=false;G.score++;laser(1,c);c.el.classList.add('hit');setTimeout(()=>G.d.forEach(d=>d.el.classList.add('boom')),250);setTimeout(nr,1100);return false}
const w=G.d.find(d=>!d.c&&ok(v,d.t));
if(w){inp.value='';laser(0,w);w.el.classList.remove('shield');void w.el.offsetWidth;w.el.classList.add('shield');$('#ms').textContent='Wrong drone: its shield absorbed the shot. Nothing happens.'}
else{inp.classList.remove('shake');void inp.offsetWidth;inp.classList.add('shake');$('#ms').textContent='No target by that name.';inp.select()}return false}

/* Level 3 */
/* Multi-part rules: a group is 3 terms of the same category (never sharing a name/alias); it becomes a word-bank
   matching question with 2 extra bank terms that fit nothing; each bank term is used at most once; 1 point per part.
   About 30% of questions are multi-part when the set has at least 6 terms. */
const bankx=(g,n)=>{const src=S.pool.length>=6?S.pool:S.all,o=src.filter(x=>!g.includes(x)&&!g.some(y=>forms(y).some(f=>forms(x).includes(f))));return[...sh(o.filter(x=>x.category==g[0].category)),...sh(o.filter(x=>x.category!=g[0].category))].slice(0,n)};
function mcq(){const u=new Set(),l=[];let tot=0;
for(const t of sh(S.pool)){if(l.length>=L[3])break;if(u.has(t))continue;u.add(t);
const c=sh(S.pool.filter(x=>x!=t&&x.category==t.category&&!forms(t).some(f=>forms(x).includes(f)))),cand=[...c.filter(x=>!u.has(x)),...c.filter(x=>u.has(x))];
if(S.pool.length>=6&&cand.length>=2&&Math.random()<.3){const g=[t,cand[0],cand[1]];g.forEach(x=>u.add(x));l.push({g,b:sh([...g,...bankx(g,2)])});tot+=3}
else{l.push({t,rev:Math.random()<.5,o:sh([t,...decoys(t,3)])});tot++}}
Q={l,tot,i:0,r:0,m:[]};mr()}
function mm(q){V.innerHTML=`<div class="hud"><span>Question ${Q.i+1} / ${Q.l.length} · multi-part</span><span>Points ${Q.r}</span></div><div class="q"><p class="mute">Match each definition to a term from the word bank. Each term is used at most once, and 2 bank terms match nothing.</p><div class="chips">${q.b.map(t=>`<span class="bk">${esc(t.term)}</span>`).join('')}</div>${q.g.map((t,k)=>`<p><b>${'abc'[k]})</b> ${mask(t)}</p><select id="s${k}" aria-label="Part ${'abc'[k]}"><option value="">Choose a term…</option>${q.b.map((b,j)=>`<option value="${j}">${esc(b.term)}</option>`).join('')}</select><span id="r${k}"></span>`).join('')}<p class="err" id="me"></p><div class="row" id="nx"><button class="pri" onclick="mk()">Check answers</button></div></div>`}
function mk(){const q=Q.l[Q.i],v=q.g.map((_,k)=>$('#s'+k).value);if(v.includes(''))return $('#me').textContent='Answer every part first.';
if(new Set(v).size<v.length)return $('#me').textContent='Each term can be used only once.';let n=0;
q.g.forEach((t,k)=>{const g=q.b[v[k]]==t;$('#s'+k).disabled=true;$('#r'+k).innerHTML=g?' <b style="color:var(--ok)">Correct</b>':` <b style="color:var(--bad)">Answer: ${esc(t.term)}</b>`;g?n++:Q.m.push(t)});Q.r+=n;
$('#me').textContent='';$('#nx').innerHTML=`<button class="pri" onclick="Q.i++;Q.i<Q.l.length?mr():done('Multiple choice complete',Q.r,Q.tot,Q.m,true)">${Q.i<Q.l.length-1?'Next':'Finish'}</button>`;$('#nx button').focus()}
function mr(){const q=Q.l[Q.i];Q.a=false;if(q.g)return mm(q);V.innerHTML=`<div class="hud"><span>Question ${Q.i+1} / ${Q.l.length}</span><span>Correct ${Q.r}</span></div><div class="q"><p class="mute">${q.rev?'Which definition matches this term?':'Which term matches this definition?'}</p><h2>${q.rev?esc(q.t.term):mask(q.t)}</h2>${q.o.map((o,k)=>`<button class="opt" id="o${k}" onclick="pk(${k})">${q.rev?esc(o.definition):esc(o.term)}</button>`).join('')}<div class="row" id="nx"></div></div>`}
function pk(k){if(Q.a)return;Q.a=true;const q=Q.l[Q.i],g=q.o.indexOf(q.t);q.o.forEach((_,j)=>{$('#o'+j).disabled=true});$('#o'+g).classList.add('good');if(k==g)Q.r++;else{$('#o'+k).classList.add('no');Q.m.push(q.t)}
$('#nx').innerHTML=`<button class="pri" onclick="Q.i++;Q.i<Q.l.length?mr():done('Multiple choice complete',Q.r,Q.tot,Q.m,true)">${Q.i<Q.l.length-1?'Next':'Finish'}</button>`;$('#nx button').focus()}

/* Level 4 */
/* Key-word rules: blanks are the 2-4 most specific words of the definition: numbers, acronyms, or words of 6+ letters,
   never stop-words or words from the term itself; rarer words (fewer definitions use them) rank higher. Case, plurals and
   one typo (7+ letters) are forgiven. About 40% of questions use this format; 1 point per blank. */
const STOP=new Set('about above after again also because been before being between both cannot could does doing during each either from have having into itself just made make many more most much must only other over same should since some such than that their them then there these they this those through under until upon very were what when where which while will with within without would your'.split(' '));
const toks=s=>[...String(s).matchAll(/[A-Za-z0-9][A-Za-z0-9-]*/g)].map(m=>({w:m[0],i:m.index}));
function kws(t){const d=t.definition,tk=toks(d),hide=new Set([t.term,...(t.aliases||[])].flatMap(x=>norm(x).split(' ')).filter(Boolean)),seen=new Set(),ac=x=>/^[A-Z]{2,}$/.test(x);
const c=tk.filter(x=>{const l=x.w.toLowerCase();if(seen.has(l)||STOP.has(l)||hide.has(norm(x.w))||!(/\d/.test(x.w)||ac(x.w)||x.w.length>=6))return false;seen.add(l);return true});
if(c.length<2)return null;const sc=x=>x.w.length+(/\d/.test(x.w)?5:0)+(ac(x.w)?3:0)-3*(S.df[x.w.toLowerCase()]||1);
const k=Math.max(2,Math.min(4,Math.round(tk.length/8))),keys=[...c].sort((a,b)=>sc(b)-sc(a)).slice(0,k).sort((a,b)=>a.i-b.i);let h='',p=0;
keys.forEach((x,n)=>{h+=esc(d.slice(p,x.i))+`<input type="text" id="b${n}" autocomplete="off" aria-label="Blank ${n+1}" style="width:${Math.max(5,x.w.length+2)}ch;display:inline-block;padding:2px 6px">`;p=x.i+x.w.length});return{keys,html:h+esc(d.slice(p))}}
const kok=(v,w)=>{const a=norm(v),b=norm(w),s=x=>x.replace(/(es|s)$/,'');return !!a&&(same(a,b)||same(s(a),s(b))||(b.length>=7&&sig(a)==sig(b)&&lev(a,b)<=1))};
function free(){const l=sh(S.pool).slice(0,L[4]),k=new Map();let tot=0;l.forEach(t=>{const x=Math.random()<.4&&kws(t);if(x){k.set(t,x);tot+=x.keys.length}else tot++});Q={l,k,tot,i:0,r:0,m:[]};fq()}
function fm(t,x){Q.done=false;V.innerHTML=`<div class="hud"><span>Question ${Q.i+1} / ${Q.l.length} · key words</span><span>Points ${Q.r}</span></div><div class="q"><p class="mute">Fill in the ${x.keys.length} key words (numbers, acronyms and technical terms) missing from this definition.</p><h2>${esc(t.term)}</h2><form onsubmit="return fk()"><p style="line-height:2.3">${x.html}</p><div class="row"><button class="pri" id="sb">Check</button></div></form><div id="fb"></div></div>`;$('#b0').focus()}
function fk(){const t=Q.l[Q.i],x=Q.k.get(t);if(Q.done){fnx();return false}Q.done=true;let n=0;const ms=[];
x.keys.forEach((w,k)=>{const i=$('#b'+k),g=kok(i.value,w.w);i.disabled=true;i.style.borderColor=g?'var(--ok)':'var(--bad)';g?n++:ms.push(w.w)});Q.r+=n;if(ms.length)Q.m.push(t);
$('#fb').innerHTML=`<p><b>${n} / ${x.keys.length}</b></p>`+(ms.length?`<p style="color:var(--bad)">Missing: <b>${ms.map(esc).join(', ')}</b></p>`:'');$('#sb').textContent=Q.i<Q.l.length-1?'Next':'Finish';$('#sb').focus();return false}
function fq(){const t=Q.l[Q.i];if(Q.k.has(t))return fm(t,Q.k.get(t));V.innerHTML=`<div class="hud"><span>Question ${Q.i+1} / ${Q.l.length}</span><span>Correct ${Q.r}</span></div><div class="q"><p class="mute">Type the term that matches this definition:</p><h2 style="font-size:1.1rem">${mask(t)}</h2><form onsubmit="return fc()"><input type="text" id="ty" autocomplete="off" aria-label="Your answer"><div class="row"><button class="pri" id="sb">Check</button></div></form><div id="fb"></div></div>`;$('#ty').focus()}
function fc(){const t=Q.l[Q.i];if(Q.done){fnx();return false}const good=ok($('#ty').value,t);Q.done=true;Q.cur=good;if(good)Q.r++;else Q.m.push(t);
$('#ty').disabled=true;$('#sb').textContent=Q.i<Q.l.length-1?'Next':'Finish';$('#fb').innerHTML=good?'<p style="color:var(--ok)"><b>Correct.</b></p>':`<p style="color:var(--bad)"><b>Not quite.</b> Answer: <b>${esc(t.term)}</b></p><button type="button" onclick="ov()">My answer was right, count it</button>`;$('#sb').focus();return false}
function ov(){const t=Q.l[Q.i];Q.m=Q.m.filter(x=>x!==t);Q.r++;Q.cur=true;$('#fb').innerHTML='<p style="color:var(--ok)"><b>Counted as correct.</b></p>'}
function fnx(){Q.done=false;Q.i++;Q.i<Q.l.length?fq():done('Free response complete',Q.r,Q.tot,Q.m,false)}
loadLib();buildS();nav();setup();
