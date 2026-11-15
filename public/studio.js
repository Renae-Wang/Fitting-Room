import {openStore,all,batch,put,remove,photoRecord,referenceJPEG,collectAssets,assetBlob,uploadPhoto} from './store.js';
import {planPieces,createIntake,describedRecord,genericName,vagueName} from './intake.js';
import {tokenize,alignWords,wordAt} from './readaloud.js';
import {client,configured,keyProblem,currentSession,sendLink,signOut,api} from './supabase.js';
import {AREAS,SPOT_LABELS,lookAreas,spotsFor,cropStyle,containRect} from './details.js';

const categories=['Tops','Bottoms','Dresses / One-pieces','Outerwear','Shoes','Bags','Jewelry','Other Accessories','Makeup','Full Looks / Outfit References'];
const occasions=['Everyday / Class','Date Night — Attract a Boyfriend','Queer Night Out / Meet a Masc Lesbian','Professional / Get a Job','Coffee Chat / Networking','Make Friends / Approachable','Creative Industry Event','Presenting My Work','Surprise Me','Custom Occasion'];
const refSlots=[['body-front','Full body · front',true],['head-front','Headshot · front',true],['body-side','Full body · side'],['body-back','Full body · back or three-quarter'],['head-left','Headshot · left three-quarter'],['head-right','Headshot · right three-quarter']];
const defaults={occasion:occasions[0],context:'',creativity:8,sass:3,style:''};
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={closet:'M2 16l8-5c1-1 3-2 2-4-1-2-4-2-5 1 M10 11l10 6H2z',history:'M4 6h12v14H4z M8 3h11v13',arrow:'M4 10h13m-5-5 5 5-5 5',plus:'M10 4v12M4 10h12',spark:'m10 2 1.6 5.4L17 9l-5.4 1.6L10 16l-1.6-5.4L3 9l5.4-1.6z'};
const icon=k=>'<svg class="icon" viewBox="0 0 22 22" aria-hidden="true"><path d="'+paths[k]+'"/></svg>';
const options=(arr,value)=>arr.map(v=>'<option'+(v===value?' selected':'')+'>'+esc(v)+'</option>').join('');
const uid=()=>crypto.randomUUID();
const idMap=rows=>new Map(rows.map(r=>[r.id,r]));
let items=[],refs=[],looks=[],assets=new Map(),settings={},state={enabled:false},busy='',failure='',active='',ready=false,cleanupMirror,navSeq=0,noticeTimer,dialogSeq=0;
// busy: '' | 'select' | 'render'. held: the image kept visible while a new one renders.
let held=null,sameRun=false,renderError=null,detailsOn=false,guard=null,spotObserver,intake=null,intakeTimer=null,pillTimer=null;const locating=new Set(),unmapped=new Set();
const pref=()=>({...defaults,...settings});
const current=()=>looks.find(l=>l.id===active);
// Unreviewed pieces never reach the stylist until they're added to the closet.
const available=()=>items.filter(i=>!i.intake&&i.status==='available'&&categories.includes(i.category)&&i.category!==categories.at(-1)&&i.photos?.length);
const coverage=()=>{const cats=new Set(available().map(i=>i.category));return {shoes:cats.has('Shoes'),base:cats.has(categories[2])||(cats.has('Tops')&&cats.has('Bottoms')),body:refs.some(r=>r.id==='body-front'),face:refs.some(r=>r.id==='head-front')}};
function source(id){return assets.get(id)?.url||''}
function notify(s){$('#notice').textContent=s;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#notice').textContent='',5500)}
async function refresh(){const [i,r,l,s,a]=await Promise.all(['items','refs','looks','settings','assets'].map(all));items=i;refs=r;looks=l.sort((x,y)=>y.created-x.created);settings=Object.fromEntries(s.map(v=>[v.id,v.value]));assets=idMap(a)}
async function setting(id,value){settings[id]=value;await put('settings',{id,value})}
const publicItem=({photos,intake,nameLocked,categoryLocked,created,...item})=>item;
function context(){const p=pref();return {wardrobe:items.filter(i=>!i.intake).map(publicItem),outfit:current()?lookFields(current()):null,preferences:{style:p.style,creativity:p.creativity},occasion:p.occasion,context:p.context,sass:p.sass,feedback:historyFields()}}
function lookFields(l){return {id:l.id,title:l.title,itemIds:l.itemIds,styling:l.styling,makeup:l.makeup,makeupPlan:l.makeupPlan||[],hair:l.hair||null,reasoning:l.reasoning,occasion:l.occasion}}
function historyFields(){return looks.slice(0,25).map(l=>({title:l.title,itemIds:l.itemIds,rating:l.rating,feedback:l.feedback,occasion:l.occasion}))}
const request=(path,body)=>api(path,body);
async function status(){try{state=await request('status')}catch{state={enabled:false}}}
function sheet(title,markup){guard=null;redrawCloset=null;dialogSeq++;$('#sheet-title').textContent=title;$('#sheet-body').innerHTML=markup;const d=$('#sheet');if(!d.open)d.showModal();d.scrollTop=0}
function close(){if($('#sheet').open)$('#sheet').close()}
// Every way out of a sheet goes through requestClose, so unsaved upload work is never lost by accident.
function requestClose(proceed=close){if(guard?.dirty()){askDiscard(guard.summary?.()||'',()=>{const g=guard;guard=null;g?.discard?.();proceed()});return}guard=null;proceed()}
function askConfirm({title,body,keep,act,tone='danger'},onAct){
 const d=$('#confirm');if(d.open)return;$('#confirm-title').textContent=title;$('#confirm-body').textContent=body;
 const k=$('#keep-reviewing'),a=$('#discard-work');k.textContent=keep;a.textContent=act;a.className=tone==='danger'?'danger':'';
 k.onclick=()=>d.close();a.onclick=()=>{d.close();onAct()};
 d.showModal();k.focus();
}
const askDiscard=(summary,onDiscard)=>askConfirm({title:'Discard unsaved work?',body:summary,keep:'Keep reviewing',act:'Discard unsaved work'},onDiscard);
const plural=(n,one,many)=>n+' '+(n===1?one:many);
// Deleting pieces removes them and any photos nothing else uses. Looks that used them keep a placeholder.
function askDelete(ids,after){
 const n=ids.length,used=looks.filter(l=>l.itemIds?.some(id=>ids.includes(id))).length;
 askConfirm({title:'Delete '+plural(n,'piece','pieces')+'?',body:(n===1?'Its photos are':'Their photos are')+' removed from your account. '+(used?plural(used,'look','looks')+' that used '+(n===1?'it':'them')+' will show a deleted-piece placeholder. ':'')+'This can’t be undone.',keep:n===1?'Keep piece':'Keep pieces',act:'Delete '+plural(n,'piece','pieces')},
  wrap(async()=>{guard=null;await batch(ids.map(id=>({store:'items',remove:id})));await collectAssets();await refresh();for(const id of ids)picked.delete(id);after();render();notify('Deleted '+plural(n,'piece','pieces')+'.')}));
}
const sheetEl=$('#sheet'),confirmEl=$('#confirm');
$('#close-sheet').onclick=()=>requestClose();
sheetEl.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing){e.preventDefault();requestClose()}});
sheetEl.addEventListener('cancel',e=>{e.preventDefault();requestClose()});
const outside=(el,e)=>{const r=el.getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom};
let pressedBackdrop=false;
sheetEl.addEventListener('pointerdown',e=>{pressedBackdrop=e.target===sheetEl&&outside(sheetEl,e)});
sheetEl.addEventListener('click',e=>{if(pressedBackdrop&&e.target===sheetEl&&outside(sheetEl,e))requestClose();pressedBackdrop=false});
confirmEl.addEventListener('click',e=>{if(e.target===confirmEl&&outside(confirmEl,e))confirmEl.close()});
// Closing a sheet re-renders Studio; put focus back on the same control so keyboard users keep their place.
const focusKey=el=>!el||el===document.body?null:el.id?'#'+el.id:el.dataset?.spot?'.spot[data-spot="'+el.dataset.spot+'"]':el.dataset?.area?'#detail-list [data-area="'+el.dataset.area+'"]':null;
sheetEl.addEventListener('close',()=>{guard=null;dialogSeq++;if(!ready||location.hash==='#mirror')return;const key=focusKey(document.activeElement);render();if(key)$(key)?.focus()});
addEventListener('beforeunload',e=>{if((sheetEl.open&&guard?.dirty())||intake?.busy()){e.preventDefault();e.returnValue=''}});
function wrap(fn){return async e=>{try{await fn(e)}catch(err){notify(err.message||'Something went wrong. Retry the action.');const live=$('#inline-error');if(live)live.textContent=err.message}}}
function on(sel,event,fn){const el=$(sel);if(el)el.addEventListener(event,wrap(fn))}
const setupLine=(ok,action,text)=>'<li class="'+(ok?'ok':'')+'"><button type="button" data-setup="'+action+'">'+esc(text)+'</button></li>';
function setupMarkup(){const c=coverage(),count=[c.base,c.shoes,c.body&&c.face,state.enabled].filter(Boolean).length;if(count===4)return '';return '<section class="setup"><div class="setup-head">Set up your studio <span class="micro">'+count+' / 4</span></div><ul class="setup-list">'+setupLine(c.base,'closet',c.base?'Outfit foundation ready':'Add a top and bottom, or a one-piece')+setupLine(c.shoes,'closet',c.shoes?'Shoes ready':'Add a pair of shoes')+setupLine(c.body&&c.face,'profile',c.body&&c.face?'Appearance references ready':'Add a full-body front photo and headshot')+setupLine(state.enabled,'api',state.enabled?'AI services connected':'Connect AI services')+'</ul></section>'}
const live=text=>{const el=$('#viewer-live');if(el)el.textContent=text};
function caption(l){if(busy)return 'Working on your look.';if(!l)return 'Your outfit preview will appear here.';if(l.image&&renderError?.id!==l.id)return lookAreas(l,items).length&&!detailsOn?'Tap Details to explore makeup and jewelry.':'AI preview of your selected pieces.';return 'Your selected pieces are saved.'}
function viewerState(l){
 if(busy==='select')return '<div class="viewer-state busy"><span class="loading" aria-hidden="true"></span><strong>Selecting pieces…</strong><span class="micro">Step 1 of 2</span></div>';
 if(busy==='render')return '<div class="viewer-state busy"><span class="loading" aria-hidden="true"></span><strong>Rendering your look…</strong><span class="micro">'+(sameRun?'Same pieces':'Step 2 of 2')+'</span><small>This can take up to two minutes.</small></div>';
 if(!l)return '';
 if(renderError?.id===l.id||(!l.image&&l.renderFailed))return '<div class="viewer-state failed" role="alert"><strong>The image didn’t render</strong><p>Your outfit is saved with the same pieces. Retrying only redraws the image.</p>'+(renderError?.id===l.id&&renderError.message?'<small>'+esc(renderError.message)+'</small>':'')+'<button type="button" class="primary" id="retry-image" '+(state.enabled?'':'disabled')+'>Retry image</button></div>';
 if(!l.image)return '<div class="viewer-state"><strong>Your pieces are selected</strong><button type="button" class="primary" id="render-look" '+(state.enabled?'':'disabled')+'>Generate image</button></div>';
 return '';
}
const summary=a=>[a.items.length?a.items.length+(a.items.length===1?' piece':' pieces'):'',a.notes.length?a.notes.length+(a.notes.length===1?' note':' notes'):''].filter(Boolean).join(' · ');
function spotsMarkup(l,areas){
 const spots=spotsFor(areas,l.hotspots?.regions).sort((a,b)=>a.y-b.y);if(!spots.length)return '';
 return '<div class="spots" id="spots">'+spots.map(sp=>'<button type="button" class="spot" data-area="'+sp.area+'" data-spot="'+sp.spot+'" style="left:'+(sp.x*100).toFixed(2)+'%;top:'+(sp.y*100).toFixed(2)+'%" aria-label="'+esc(sp.label)+'. '+esc(AREAS[sp.area].hint)+'"><span aria-hidden="true"></span></button>').join('')+'</div>';
}
function detailList(l,areas){
 const spots=spotsFor(areas,l.hotspots?.regions),mapped=Boolean(l.hotspots);
 const note=locating.has(l.id)?'Finding your face and hands in the portrait…':!mapped&&unmapped.has(l.id)?'Markers aren’t available for this image. Choose an area below.':mapped&&!spots.length?'This pose couldn’t be mapped reliably. Choose an area below.':'Tap a marker on the portrait, or choose an area below.';
 return '<section class="detail-list" id="detail-list" aria-label="Look details"><p class="hint" role="status">'+note+'</p><ul>'+areas.map(a=>{const marked=spots.some(sp=>sp.area===a.key);return '<li><button type="button" data-area="'+a.key+'"><strong>'+esc(a.title)+'</strong><small>'+esc(summary(a))+(mapped&&!marked?' · not marked on the portrait':'')+'</small></button></li>'}).join('')+'</ul></section>';
}
function viewer(l){
 const img=busy?(l?.image||held):l?.image,date=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(Date.now());
 const ready=Boolean(l?.image&&!busy&&renderError?.id!==l.id),areas=ready?lookAreas(l,items):[];
 const alt=!img?'Illustrated dress form on a neutral background':busy&&!l?.image?'Your previous look, shown while the new one renders':'AI visualization of '+(l?.title||'your look');
 return '<figure class="plate"><div class="plate-frame'+(img?'':' empty')+(busy?' is-busy':'')+'" id="viewer"><span class="tag"><i class="dot"></i>'+(img?'AI preview':'Dress form')+'</span><img id="portrait" src="'+(img?esc(img):'form.svg')+'" alt="'+esc(alt)+'">'
  +(ready&&detailsOn?spotsMarkup(l,areas):'')+viewerState(l)
  +(ready&&areas.length?'<button type="button" class="details-toggle" id="details-toggle" aria-expanded="'+detailsOn+'"'+(detailsOn?' aria-controls="detail-list"':'')+'>'+(detailsOn?'Hide details':'Details')+'</button>':'')
  +'</div><figcaption><span>'+esc(caption(l))+'</span><span class="micro">'+esc(date)+'</span></figcaption></figure>'+(ready&&detailsOn&&areas.length?detailList(l,areas):'');
}
// ---------- Wearing a look sends its washable pieces to Laundry ----------
const washable=new Set(['Tops','Bottoms','Dresses / One-pieces']);
const today=()=>new Date().toLocaleDateString('en-CA');
const wornLabel=d=>d===today()?'Worn today':'Worn '+new Date(d+'T12:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});
function wearMarkup(l){return l.wornOn?'<span class="worn"><span class="pill">'+esc(wornLabel(l.wornOn))+'</span><button type="button" class="text-btn" id="unwear-look">Undo</button></span>':'<button type="button" id="wear-look">Wearing this today</button>'}
async function wear(){
 const l=looks.find(x=>x.id===current()?.id);if(!l)return;
 const wash=l.itemIds.map(id=>items.find(i=>i.id===id)).filter(i=>i&&washable.has(i.category)&&i.status==='available');
 await batch([...wash.map(i=>({store:'items',record:{...i,status:'laundry'}})),{store:'looks',record:{...l,saved:true,wornOn:today(),laundered:wash.map(i=>i.id)}}]);
 await refresh();refreshLook();$('#unwear-look')?.focus();
 notify(wash.length?plural(wash.length,'piece','pieces')+' moved to Laundry. Shoes and accessories stay available.':'Marked as worn today.');
}
async function unwear(){
 const l=looks.find(x=>x.id===current()?.id);if(!l)return;
 const back=(l.laundered||[]).map(id=>items.find(i=>i.id===id)).filter(i=>i?.status==='laundry');
 await batch([...back.map(i=>({store:'items',record:{...i,status:'available'}})),{store:'looks',record:{...l,wornOn:undefined,laundered:undefined}}]);
 await refresh();refreshLook();$('#wear-look')?.focus();notify(back.length?plural(back.length,'piece is','pieces are')+' available again.':'No longer marked as worn.');
}
async function setStatus(ids,status){
 const list=ids.map(id=>items.find(i=>i.id===id)).filter(i=>i&&i.status!==status);
 if(list.length)await batch(list.map(i=>({store:'items',record:{...i,status}})));await refresh();return list.length;
}
// The makeup plan as color swatches: shade, where it goes, and on which product.
function swatches(l){
 const plan=Array.isArray(l.makeupPlan)?l.makeupPlan.filter(s=>s&&s.shade):[];if(!plan.length)return '';
 return '<ul class="swatches" aria-label="Makeup shades">'+plan.map(s=>{const it=items.find(i=>i.id===s.itemId);return '<li><span class="swatch" style="background:'+(/^#[0-9a-f]{6}$/i.test(s.hex||'')?s.hex:'transparent')+'" aria-hidden="true"></span><div><strong>'+esc(s.shade)+'</strong><small>'+esc([s.area,it?.name].filter(Boolean).join(' · '))+'</small></div></li>'}).join('')+'</ul>';
}
function details(l){
 const pieces=l.itemIds.map(id=>{const it=items.find(i=>i.id===id);return it?'<div class="item-chip" role="listitem"><img src="'+esc(source(it.photos[0]))+'" alt=""><span>'+esc(it.name)+'</span></div>':'<div class="item-chip gone" role="listitem"><span class="hint">Deleted closet item</span></div>'}).join('');
 return '<section class="look-card"><span class="micro">Look notes</span><h2>'+esc(l.title)+'</h2><div class="actions"><button type="button" id="save-look" '+(l.saved?'disabled':'')+'>'+(l.saved?'Saved to lookbook':'Save look')+'</button>'+wearMarkup(l)+'<button type="button" id="rate-look">Rate after wearing</button>'+(l.image&&!busy&&renderError?.id!==l.id?'<button type="button" class="text-btn" id="regenerate" '+(state.enabled?'':'disabled')+'>Regenerate image</button>':'')+'</div>'
  +'<details class="settings" data-keep="why"><summary>Why this look</summary><div>'+sayMarkup(l,'why')+'</div></details>'
  +'<details class="settings" data-keep="pieces" open><summary>Pieces · '+l.itemIds.length+'</summary><div class="item-strip" role="list" aria-label="Pieces in this look">'+pieces+'</div></details>'
  +'<details class="settings" data-keep="steps"><summary>'+(l.hair?.style?'Styling, hair &amp; makeup':'Styling &amp; makeup')+'</summary><div>'+swatches(l)+sayMarkup(l,'steps')+'</div></details></section>';
}
// ---------- Read aloud: look notes in a natural voice, highlighting each word as it's spoken ----------
let reader=null;
const hairLine=l=>l.hair?.style?'Hair: '+String(l.hair.style).trim().replace(/[.]$/,'')+'. '+String(l.hair.steps||'').trim():'';
const sayParts=(l,key)=>(key==='why'?[l.reasoning]:[l.styling,hairLine(l),l.makeup]).map(p=>String(p||'').trim()).filter(Boolean);
const sayText=(l,key)=>sayParts(l,key).join('\n\n');
async function textId(text){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('marin|'+text));return Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,'0')).join('')}
function sayMarkup(l,key){
 let n=0;const parts=sayParts(l,key);if(!parts.length)return '';
 const mine=reader&&reader.lookId===l.id&&reader.key===key?reader.status:'idle';
 const cached=l.voice?.[key]&&assets.has(l.voice[key].asset);
 const label={idle:'Listen',loading:'Preparing audio…',playing:'Pause',paused:'Resume',ended:'Listen again'}[mine];
 const paras=parts.map(p=>'<p>'+tokenize(p).map(t=>t.word?'<span data-w="'+(n++)+'">'+esc(t.t)+'</span>':esc(t.t)).join('')+'</p>').join('');
 return '<div class="say'+(mine==='playing'||mine==='paused'?' is-reading':'')+'" data-say="'+key+'"><button type="button" class="listen" data-listen="'+key+'" aria-label="'+esc(label)+': '+(key==='why'?'why this look':'styling and makeup')+'" '+(mine==='loading'||(!cached&&!state.enabled&&mine==='idle')?'disabled':'')+'><svg class="icon" viewBox="0 0 22 22" aria-hidden="true"><path d="'+(mine==='playing'?'M7 5v12M15 5v12':mine==='loading'?'M4 11h2m4 0h2m4 0h2':'M4 8h3l5-4v14l-5-4H4z M15 8q2 3 0 6')+'"/></svg>'+esc(label)+'</button>'+paras+'</div>';
}
function sayButtons(){document.querySelectorAll('#look-col [data-say]').forEach(box=>{const l=current();if(!l)return;const key=box.dataset.say,fresh=document.createElement('div');fresh.innerHTML=sayMarkup(l,key);const btn=fresh.querySelector('.listen');box.querySelector('.listen')?.replaceWith(btn);btn.onclick=wrap(()=>listen(key));box.classList.toggle('is-reading',reader?.key===key&&(reader.status==='playing'||reader.status==='paused'))})}
function stopReader(){if(!reader)return;cancelAnimationFrame(reader.raf);reader.audio?.pause();if(reader.temp)URL.revokeObjectURL(reader.temp);document.querySelectorAll('#look-col [data-w].spoken').forEach(s=>s.classList.remove('spoken'));reader=null;sayButtons()}
// Paints the highlight on the word being spoken. The loop runs only while playing, and only one at a time.
function paint(){
 const r=reader;if(!r||!r.audio||!r.times)return;
 const i=r.status==='playing'?wordAt(r.times,r.audio.currentTime):r.last;
 if(i!==r.shown){document.querySelectorAll('#look-col [data-say="'+r.key+'"] [data-w].spoken').forEach(s=>s.classList.remove('spoken'));if(i>=0)document.querySelector('#look-col [data-say="'+r.key+'"] [data-w="'+i+'"]')?.classList.add('spoken');r.shown=i}
 r.last=i;
}
function follow(){const r=reader;if(!r)return;cancelAnimationFrame(r.raf);const step=()=>{if(reader!==r)return;paint();if(r.status==='playing')r.raf=requestAnimationFrame(step)};step()}
async function listen(key){
 const l=current();if(!l)return;
 if(reader&&reader.lookId===l.id&&reader.key===key&&reader.audio){
  if(reader.status==='playing'){reader.audio.pause();reader.status='paused';sayButtons();return}
  if(reader.status==='ended')reader.audio.currentTime=0;
  reader.status='playing';await reader.audio.play();follow();sayButtons();return;
 }
 stopReader();
 const text=sayText(l,key),words=tokenize(sayParts(l,key).join(' ')).filter(t=>t.word).map(t=>t.t);
 const r=reader={lookId:l.id,key,status:'loading',shown:-1,last:-1};sayButtons();
 try{
  const id='voice-'+(await textId(text));let url,timed;
  const saved=l.voice?.[key];
  if(saved?.asset===id&&assets.has(id)){url=source(id);timed=saved.words}
  else{
   const res=await request('speak',{text});
   const bytes=Uint8Array.from(atob(String(res.audio||'').split(',')[1]||''),c=>c.charCodeAt(0));if(!bytes.length)throw Error('The voice service returned no audio. Try again.');
   const blob=new Blob([bytes],{type:'audio/mpeg'});r.temp=url=URL.createObjectURL(blob);timed=res.words;
   try{await uploadPhoto({id,blob});await refresh();const latest=looks.find(x=>x.id===l.id);if(latest)await put('looks',{...latest,voice:{...(latest.voice||{}),[key]:{asset:id,words:timed||null}}});await collectAssets();await refresh()}catch{}
  }
  if(reader!==r)return;
  const audio=r.audio=new Audio(url);audio.preload='auto';
  await new Promise((resolve,reject)=>{audio.onloadedmetadata=resolve;audio.onerror=()=>reject(Error('This audio could not be played. Try again.'))});
  if(reader!==r){audio.pause();return}
  r.times=alignWords(words,timed,audio.duration);
  audio.onended=()=>{if(reader!==r)return;r.status='ended';cancelAnimationFrame(r.raf);r.last=-1;follow();sayButtons()};
  r.status='playing';await audio.play();follow();sayButtons();
 }catch(e){if(reader===r){reader=null;sayButtons()}throw e}
}
const lookColumn=l=>viewer(l)+(l?details(l):'');
function keepOpen(root){const open=new Set([...root.querySelectorAll('details[open][data-keep]')].map(d=>d.dataset.keep));return ()=>root.querySelectorAll('details[data-keep]').forEach(d=>{if(open.has(d.dataset.keep))d.open=true})}
function refreshLook(){const col=$('#look-col');if(!col||!ready)return render();const restore=keepOpen(col);col.innerHTML=lookColumn(current());restore();wireLook()}
function layoutSpots(){
 spotObserver?.disconnect();const frame=$('#viewer'),img=$('#portrait'),layer=$('#spots');if(!frame||!img||!layer)return;
 const place=()=>{const r=containRect(frame.clientWidth,frame.clientHeight,img.naturalWidth,img.naturalHeight);Object.assign(layer.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'})};
 if(img.complete&&img.naturalWidth)place();else img.addEventListener('load',place,{once:true});
 spotObserver=new ResizeObserver(place);spotObserver.observe(frame);
}
function wireLook(){
 on('#details-toggle','click',()=>{detailsOn=!detailsOn;const l=current();refreshLook();$('#details-toggle')?.focus();if(detailsOn&&l?.image&&!l.hotspots)mapLook(l.id)});
 document.querySelectorAll('#look-col [data-area]').forEach(b=>b.onclick=wrap(()=>openArea(b.dataset.area,b.dataset.spot)));
 on('#retry-image','click',()=>runLook(true));on('#render-look','click',()=>runLook(true));on('#regenerate','click',()=>runLook(true));
 on('#save-look','click',async()=>{const l=current();await put('looks',{...l,saved:true});await refresh();refreshLook();notify('Saved to your lookbook.')});on('#rate-look','click',rate);on('#wear-look','click',wear);on('#unwear-look','click',unwear);
 document.querySelectorAll('#look-col [data-listen]').forEach(b=>b.onclick=wrap(()=>listen(b.dataset.listen)));
 if(reader){if(reader.lookId!==current()?.id)stopReader();else{reader.shown=-2;paint()}}
 layoutSpots();
}
// Locates face, neckline and hands on this device. Free: never calls a paid service.
async function mapLook(id){
 const l=looks.find(x=>x.id===id);if(!l?.image||l.hotspots||locating.has(id))return;
 locating.add(id);if(active===id&&detailsOn&&!busy)refreshLook();
 try{const {findRegions}=await import('./pose.js');const hotspots=await findRegions(l.image);await refresh();const latest=looks.find(x=>x.id===id);if(latest&&latest.image===l.image){await put('looks',{...latest,hotspots});await refresh()}}
 catch{unmapped.add(id)}
 finally{locating.delete(id);if(active===id&&!busy&&ready)refreshLook()}
}
// Magnified crop of the existing image plus notes and closet photos. Local only: no generation.
function openArea(key,spot){
 const l=current();if(!l?.image)return;const area=lookAreas(l,items).find(a=>a.key===key);if(!area)return;
 const regions=l.hotspots?.regions||{},aspect=l.hotspots?.aspect||2/3,keys=(key==='hands'?['handR','handL']:[key]).filter(k=>regions[k]);
 if(spot)keys.sort((a,b)=>(b===spot)-(a===spot));
 const crops=keys.map(k=>{const c=cropStyle(regions[k],aspect);return '<figure class="crop-fig"><div class="crop" role="img" aria-label="Magnified view of '+esc(SPOT_LABELS[k].toLowerCase())+'" style="aspect-ratio:'+c.ratio+';width:min(100%,calc(52dvh * '+c.ratio+'));background-image:url(&quot;'+esc(l.image)+'&quot;);background-size:'+c.size+';background-position:'+c.position+'"></div>'+(keys.length>1?'<figcaption class="micro">'+esc(SPOT_LABELS[k])+'</figcaption>':'')+'</figure>'}).join('');
 const view=crops?'<div class="crops'+(keys.length>1?' two':'')+'">'+crops+'</div>':'<div class="crop-missing"><img src="'+esc(l.image)+'" alt="Full portrait of this look"><p class="hint">This area couldn’t be located reliably in the portrait, so here’s the full image.</p></div>';
 const notes=area.notes.length?'<section class="area-part"><h3 class="section-label">Styling notes</h3><ul class="note-list">'+area.notes.map(n=>'<li>'+esc(n)+'</li>').join('')+'</ul></section>':'';
 const pieces=area.items.length?'<section class="area-part"><h3 class="section-label">From your closet</h3><p class="hint">Selected for this look. The render may not show every piece clearly.</p><div class="piece-list">'+area.items.map(i=>'<div class="piece"><img src="'+esc(source(i.photos?.[0]))+'" alt="Original photo of '+esc(i.name)+'"><div><strong>'+esc(i.name)+'</strong><span class="pill">Selected</span><small>'+esc(i.category)+'</small></div></div>').join('')+'</div></section>':'';
 const shades=key==='face'&&swatches(l)?'<section class="area-part"><h3 class="section-label">Shades</h3>'+swatches(l)+'</section>':'';
 const hair=key==='face'&&l.hair?.style?'<section class="area-part"><h3 class="section-label">Hair · '+esc(l.hair.style)+'</h3><p>'+esc(l.hair.steps||'')+'</p></section>':'';
 sheet(area.title,'<div class="vstack area-sheet">'+view+hair+shades+notes+pieces+'</div>');
}
function render(){
 if(!ready)return;
 const s=pref(),l=current(),c=coverage(),canGenerate=state.enabled&&c.base&&c.shoes&&c.body&&c.face,restore=keepOpen($('#studio'));
 $('#studio').innerHTML='<div class="studio-head"><h1>The <em>Studio</em></h1><div class="studio-actions"><button id="closet">'+icon('closet')+'Closet</button><button id="looks">'+icon('history')+'Lookbook</button></div></div><div class="editor"><div id="look-col">'+lookColumn(l)+'</div><section class="brief"><div class="brief-top"><h2>Styling brief</h2>'+icon('spark')+'</div><label class="field">Dressing for<select id="occasion">'+options(occasions,s.occasion)+'</select></label><label class="field"><span>Today’s context <small> · optional</small></span><textarea id="day-context" maxlength="1400" placeholder="Weather, dress code, plans, comfort…">'+esc(s.context)+'</textarea></label><details class="settings" data-keep="prefs"><summary>Styling preferences</summary><div>'+slider('creativity','Experimentation',s.creativity,1,10)+slider('sass','Sass',s.sass,0,4)+'<label class="field">Personal style<input id="style" value="'+esc(s.style)+'" maxlength="700" placeholder="What should the stylist remember?"></label></div></details><button class="primary" id="generate" '+(!canGenerate||busy?'disabled':'')+'>'+(busy?'<span class="loading"></span>Working on your look…':(l?'Generate new outfit':'Generate outfit')+icon('arrow'))+'</button>'+(canGenerate?'<p class="action-note">Uses one styling request and one image request. '+esc(state.remaining?.image??'—')+' image requests left today.</p>':'')+(failure?'<p role="alert" class="fail">'+esc(failure)+'</p>':'')+setupMarkup()+'</section></div>';
 on('#closet','click',closet);on('#looks','click',()=>{location.hash='#lookbook'});on('#occasion','change',e=>setting('occasion',e.target.value));on('#day-context','input',e=>setting('context',e.target.value));on('#style','input',e=>setting('style',e.target.value));
 for(const id of ['creativity','sass'])wireSlider(id);
 on('#generate','click',()=>runLook(false));restore();wireLook();
 document.querySelectorAll('[data-setup]').forEach(b=>b.onclick=wrap(()=>({closet,profile,api:apiInfo})[b.dataset.setup]()));
}
function slider(id,label,value,min,max){return '<label class="field"><span>'+label+' · <output id="'+id+'-value">'+value+'</output> / '+max+'</span><input id="'+id+'" type="range" min="'+min+'" max="'+max+'" value="'+value+'"></label>'}
function wireSlider(id){on('#'+id,'input',async e=>{const value=+e.target.value;$('#'+id+'-value').value=value;await setting(id,value)})}
function apiInfo(){sheet('AI services','<div class="vstack"><p class="sheet-copy">'+(state.enabled?'AI is connected.':'AI is off. In Supabase, add OPENAI_API_KEY and set ENABLE_PAID_API to true in the function secrets, then refresh.')+'</p><p class="sheet-copy">Selecting a look sends wardrobe descriptions and recent feedback. Rendering sends the chosen garment images and appearance references. Tagging sends the photo you choose.</p><div class="actions"><button id="check-api">Refresh connection</button></div></div>');on('#check-api','click',async()=>{await status();apiInfo();render()})}
async function visualize(l){
 await refresh();const checked=l.itemIds.map(id=>items.find(i=>i.id===id&&i.photos?.length));if(checked.some(i=>!i))throw Error('A piece in this look was deleted from your closet. Choose a new outfit.');
 const front=refs.find(r=>r.id==='body-front'),head=refs.find(r=>r.id==='head-front');if(!front||!head)throw Error('Add a front-facing full-body photo and a headshot to visualize this look.');
 const img=async id=>referenceJPEG(await assetBlob(id));
 const skin=await ensureSkin();
 const body={skin:skinFields(skin),items:await Promise.all(checked.map(async i=>({...publicItem(i),...(i.category==='Makeup'?{}:{image:await img(i.photos[0])})}))),look:lookFields(l),appearance:await Promise.all([front,head,...['body-side','head-left'].map(id=>refs.find(r=>r.id===id)).filter(Boolean)].map(r=>img(r.photo)))};
 const response=await request('image',body);
 if(typeof response.image!=='string'||!response.image.startsWith('data:image/'))throw Error('The image provider returned no usable image. The outfit is still available.');
 await refresh();const latest=looks.find(i=>i.id===l.id);if(!latest)return;
 await put('looks',{...latest,image:response.image,renderFailed:false,hotspots:null,imagePrompt:response.prompt,imageModel:response.model});
}
function revealViewer(){const v=$('#viewer');if(!v)return;const r=v.getBoundingClientRect();if(r.top<0||r.top>innerHeight*0.5)v.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})}
// Skin tone and hair (length, color, texture), read once from the headshot and full-body photo, and again if either changes.
// Used to match makeup shades and to keep hairstyles possible.
async function ensureSkin(){
 const head=refs.find(r=>r.id==='head-front'),body=refs.find(r=>r.id==='body-front');if(!head||!state.enabled)return settings.skin||null;
 const ref=head.photo+'|'+(body?.photo||'');
 if(settings.skin?.ref===ref&&settings.skin.hairLength!==undefined)return settings.skin;
 try{
  const img=async id=>referenceJPEG(await assetBlob(id));
  const res=await request('skin',{image:await img(head.photo),...(body?{body:await img(body.photo)}:{})});
  const skin={depth:res.depth,undertone:res.undertone,hex:res.hex,notes:res.notes,hairLength:res.hairLength||'',hairColor:res.hairColor||'',hairTexture:res.hairTexture||'',ref};await setting('skin',skin);return skin;
 }catch{return settings.skin||null}
}
const skinFields=skin=>skin?{depth:skin.depth,undertone:skin.undertone,hex:skin.hex,notes:skin.notes,hairLength:skin.hairLength,hairColor:skin.hairColor,hairTexture:skin.hairTexture}:undefined;
async function runLook(imageOnly){
 if(busy)return;stopReader();failure='';renderError=null;detailsOn=false;held=current()?.image||null;sameRun=imageOnly;
 busy=imageOnly?'render':'select';render();revealViewer();live(imageOnly?'Rendering your look…':'Selecting pieces…');
 let mapped=null;
 try{
  await refresh();let l=current();if(!imageOnly){
   const p=pref();if(p.occasion==='Custom Occasion'&&!p.context.trim())throw Error('Describe your custom occasion in today’s context.');const skin=await ensureSkin();const result=await request('select',{items:available().map(publicItem),occasion:p.occasion,context:p.context,preferences:p.style,history:historyFields(),sass:p.sass,creativity:p.creativity,skin:skinFields(skin)});
   await refresh();const usable=new Set(available().map(i=>i.id));if(!Array.isArray(result.itemIds)||!result.itemIds.length||new Set(result.itemIds).size!==result.itemIds.length||result.itemIds.some(i=>!usable.has(i)))throw Error('The selected pieces could not be matched to your current closet. Try again.');
   l={...result,id:uid(),created:Date.now(),occasion:p.occasion,saved:false,rating:null,feedback:''};
   await batch([{store:'looks',record:l},{store:'settings',record:{id:'activeLook',value:l.id}}]);active=l.id;await refresh();busy='render';render();live('Rendering your look…');
  }if(!l)throw Error('Generate an outfit first.');
  try{await visualize(l);mapped=l.id;live('Your look is ready.')}catch(err){
   const saved=(await all('looks')).find(row=>row.id===l.id);
   if(saved&&!saved.image)await put('looks',{...saved,renderFailed:true});
   renderError={id:l.id,message:err.message};live('The image didn’t render. Retry image is available.');
  }
 }catch(e){failure=e.message;live(e.message)}finally{busy='';held=null;await refresh();await status();render()}
 if(mapped)mapLook(mapped);
}
// ---------- Lookbook: its own page. A gallery carousel of every look, then all of them below. ----------
let lbIndex=0;
const lookDate=l=>new Date(l.created||Date.now()).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
function openLook(id){active=id;detailsOn=false;renderError=null;setting('activeLook',id);location.hash='#studio'}
function deleteLook(id,after){askConfirm({title:'Delete this look?',body:'Its preview, notes and rating are removed. Your closet pieces stay. This can’t be undone.',keep:'Keep look',act:'Delete look'},wrap(async()=>{if(reader?.lookId===id)stopReader();await remove('looks',id);await collectAssets();await refresh();if(active===id){active=looks[0]?.id||'';await setting('activeLook',active)}after()}))}
function closeUp(l){
 sheet(l.title,'<div class="vstack lb-close">'+(l.image?'<img src="'+esc(l.image)+'" alt="'+esc(l.title)+'">':'<div class="empty-note">This look has no image yet.</div>')+'<p class="hint">'+esc(lookDate(l))+' · '+esc(l.occasion||'')+(l.wornOn?' · '+esc(wornLabel(l.wornOn)):'')+(l.rating?' · '+l.rating+'/5':'')+'</p><div class="actions"><button type="button" class="primary" id="lb-open">Open in Studio</button></div></div>');
 on('#lb-open','click',()=>{close();openLook(l.id)});
}
function lookbookPage(){
 const root=$('#lookbook');if(!root)return;
 const list=looks;lbIndex=Math.max(0,Math.min(lbIndex,list.length-1));
 const head='<div class="studio-head"><h1>The <em>Lookbook</em></h1>'+(list.length?'<p class="hint lb-count">'+plural(list.length,'look','looks')+'</p>':'')+'</div>';
 if(!list.length){root.innerHTML='<section class="lb">'+head+'<div class="empty-note">Your looks appear here after you generate one in the Studio.</div></section>';return}
 const pic=(l,eager)=>l.image?'<img src="'+esc(l.image)+'" alt="" draggable="false"'+(eager?'':' loading="lazy"')+'>':'<span class="lb-blank">No image yet</span>';
 root.innerHTML='<section class="lb">'+head
  +'<div class="lb-stage" role="region" aria-roledescription="carousel" aria-label="Your looks"><button type="button" class="lb-arrow prev" aria-label="Previous look">‹</button><div class="lb-track">'
  +list.map((l,i)=>'<figure class="lb-slide" data-i="'+i+'" role="group" aria-roledescription="slide" aria-label="'+(i+1)+' of '+list.length+'"><button type="button" class="lb-pic" aria-label="'+esc(l.title)+', '+esc(lookDate(l))+'. Open close-up">'+pic(l,Math.abs(i-lbIndex)<3)+'</button><figcaption><strong>'+esc(l.title)+'</strong><small>'+esc(lookDate(l))+'</small></figcaption></figure>').join('')
  +'</div><button type="button" class="lb-arrow next" aria-label="Next look">›</button></div>'
  +'<div class="lb-actions actions"><button type="button" class="primary" id="lb-studio">Open in Studio</button><button type="button" id="lb-delete" class="text-btn">Delete look</button></div>'
  +'<h2 class="section-label lb-all">All looks</h2><div class="lb-grid">'+list.map((l,i)=>'<button type="button" class="lb-card" data-go="'+i+'" data-look="'+esc(l.id)+'">'+pic(l)+'<strong>'+esc(l.title)+'</strong><small>'+esc(lookDate(l))+'</small></button>').join('')+'</div></section>';
 const slides=[...root.querySelectorAll('.lb-slide')],stage=root.querySelector('.lb-stage');
 const place=()=>{
  slides.forEach((el,i)=>{const d=i-lbIndex,a=Math.abs(d),far=a>2;
   el.style.setProperty('--d',String(d));el.style.setProperty('--a',String(Math.min(a,3)));
   el.classList.toggle('focus',a===0);el.classList.toggle('far',far);el.setAttribute('aria-hidden',String(a!==0));el.inert=a!==0&&far;
   el.querySelector('.lb-pic').tabIndex=a===0?0:-1;});
  root.querySelector('.lb-arrow.prev').disabled=lbIndex===0;root.querySelector('.lb-arrow.next').disabled=lbIndex===list.length-1;
  root.querySelectorAll('.lb-card').forEach((c,i)=>c.classList.toggle('current',i===lbIndex));
  live(list[lbIndex].title+', '+lookDate(list[lbIndex]));
 };
 const go=i=>{lbIndex=Math.max(0,Math.min(i,list.length-1));place()};
 slides.forEach((el,i)=>el.querySelector('.lb-pic').onclick=()=>{if(i===lbIndex)closeUp(list[i]);else go(i)});
 root.querySelector('.lb-arrow.prev').onclick=()=>go(lbIndex-1);root.querySelector('.lb-arrow.next').onclick=()=>go(lbIndex+1);
 stage.onkeydown=e=>{if(e.key==='ArrowLeft'){e.preventDefault();go(lbIndex-1);root.querySelector('.lb-slide.focus .lb-pic').focus()}if(e.key==='ArrowRight'){e.preventDefault();go(lbIndex+1);root.querySelector('.lb-slide.focus .lb-pic').focus()}};
 let x0=null;stage.onpointerdown=e=>{x0=e.clientX};stage.onpointerup=e=>{if(x0===null)return;const dx=e.clientX-x0;x0=null;if(Math.abs(dx)>40){go(lbIndex+(dx<0?1:-1));e.preventDefault()}};
 root.querySelectorAll('[data-go]').forEach(c=>c.onclick=()=>{go(Number(c.dataset.go));stage.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})});
 on('#lb-studio','click',()=>openLook(list[lbIndex].id));
 on('#lb-delete','click',()=>deleteLook(list[lbIndex].id,lookbookPage));
 place();
}
function rate(){const l=current();sheet('After wearing','<form id="feedback" class="vstack"><label class="field">Rating<select name="rating" required><option value="">Choose a rating</option>'+[1,2,3,4,5].map(v=>'<option value="'+v+'" '+(v===l.rating?'selected':'')+'>'+v+' / 5</option>').join('')+'</select></label><label class="field">What worked or missed?<textarea name="feedback" maxlength="1000">'+esc(l.feedback)+'</textarea></label><button class="primary">Save feedback</button></form>');on('#feedback','submit',async e=>{e.preventDefault();const f=new FormData(e.target);const latest=(await all('looks')).find(x=>x.id===l.id);if(!latest)throw Error('This look has been removed.');await put('looks',{...latest,rating:Number(f.get('rating')),feedback:f.get('feedback')});await refresh();close();notify('Feedback saved for future styling requests.')})}
// ---------- Closet: every piece, sorted by AI as it arrives ----------
let picking=false,closetTab='closet',redrawCloset=null;const picked=new Set();
const closetPieces=()=>items.filter(i=>i.status!=='laundry');
const laundryItems=()=>items.filter(i=>i.status==='laundry');
const pools={closet:closetPieces,laundry:laundryItems};
const needsFix=i=>!i.intake&&(!categories.includes(i.category)||genericName(i.name)||vagueName(i.name));
const tabButton=(key,label,n)=>'<button type="button" role="tab" id="tab-'+key+'" data-tab="'+key+'" aria-selected="'+(closetTab===key)+'" tabindex="'+(closetTab===key?0:-1)+'">'+label+' <span class="count">'+n+'</span></button>';
// ---------- AI sorting: names, categorises and describes each piece from its photo ----------
const ai={queue:[],inflight:new Set(),total:0,done:0,named:0,moved:[],failed:0,lastError:'',limit:false,stop:false,undo:[],changed:[],manual:false,seen:true};
const aiBusy=()=>ai.inflight.size>0||ai.queue.length>0;
const canTag=()=>state.enabled&&!(typeof state.remaining?.tag==='number'&&state.remaining.tag<=0);
let aiTimer=null;
function describe(ids,{manual=false}={}){
 if(!aiBusy())Object.assign(ai,{total:0,done:0,named:0,moved:[],failed:0,lastError:'',limit:false,stop:false,undo:[],changed:[],manual:false});
 const add=ids.filter(id=>!ai.queue.includes(id)&&!ai.inflight.has(id));
 ai.queue.push(...add);ai.total+=add.length;ai.manual=ai.manual||manual;ai.seen=false;
 pump();redrawCloset?.();updatePill();settle();
}
async function release(ids){ // Pieces AI couldn't sort still join the closet, flagged for attention.
 await refresh();const list=ids.map(id=>items.find(i=>i.id===id)).filter(i=>i?.intake);
 if(list.length)await batch(list.map(i=>({store:'items',record:{...i,intake:undefined}})));
}
function pump(){
 while(ai.inflight.size<3&&ai.queue.length&&!ai.stop){
  const id=ai.queue.shift();ai.inflight.add(id);
  describeOne(id).then(async result=>{if(result==='limit')await release([id]);else ai.done++}).catch(()=>{}).finally(()=>{ai.inflight.delete(id);if(ai.stop&&ai.queue.length){const rest=ai.queue.splice(0);release(rest).then(settle)}pump();settle()});
 }
}
async function describeOne(id){
 if(!items.some(i=>i.id===id))await refresh();
 const it=items.find(i=>i.id===id);if(!it?.photos?.length)return 'skip';
 const label=genericName(it.name)||vagueName(it.name)?'':it.name;
 try{
  const {suggestions}=await request('tag',{image:await referenceJPEG(await assetBlob(it.photos[0])),...(label?{label}:{})});
  if(typeof state.remaining?.tag==='number')state.remaining.tag=Math.max(0,state.remaining.tag-1);
  const latest=items.find(i=>i.id===id);if(!latest)return 'gone';
  const s=Array.isArray(suggestions)?suggestions[0]:null;
  if(!s){ai.failed++;ai.lastError='nothing recognisable in the photo';if(latest.intake)await put('items',{...latest,intake:undefined});return 'failed'}
  const {record,filled}=describedRecord(latest,s,{categories});
  if(!latest.intake&&filled.length){
   ai.undo.push({id,prev:Object.fromEntries(filled.map(k=>[k,latest[k]??'']))});
   if(filled.includes('category')&&latest.category)ai.moved.push(id);
   if(filled.includes('name')||filled.includes('category'))ai.changed.push(id);
  }
  if(filled.includes('name'))ai.named++;
  if(filled.length||latest.intake)await put('items',{...record,intake:undefined});
  return 'ok';
 }catch(e){
  if(/limit reached/i.test(e.message||'')){ai.stop=true;ai.limit=true;if(state.remaining)state.remaining.tag=0;return 'limit'}
  ai.failed++;ai.lastError=String(e.message||'').slice(0,90);
  const latest=items.find(i=>i.id===id);if(latest?.intake)await put('items',{...latest,intake:undefined}).catch(()=>{});
  return 'failed';
 }
}
function settle(){
 if(aiTimer)return;
 aiTimer=setTimeout(async()=>{aiTimer=null;await refresh();redrawCloset?.();updatePill();if(!aiBusy()&&ai.total){await status();if(!$('#sheet').open)render();live(aiSummary())}},aiBusy()?600:0);
}
const aiHead=()=>ai.manual?'Described '+plural(ai.done,'piece','pieces'):'Sorted '+plural(ai.done,'new piece','new pieces');
function aiDetail(){
 const parts=[];
 if(ai.manual){if(ai.moved.length)parts.push(plural(ai.moved.length,'moved','moved')+' to a better category');if(ai.named)parts.push(ai.named+' renamed')}
 if(ai.failed)parts.push(plural(ai.failed,'photo','photos')+' couldn’t be read');
 return parts.join(' · ');
}
const aiSummary=()=>aiHead()+(aiDetail()?': '+aiDetail():'')+'.';
async function undoAI(){
 await refresh();const list=ai.undo.map(u=>{const it=items.find(i=>i.id===u.id);return it&&{...it,...u.prev}}).filter(Boolean);
 if(list.length)await batch(list.map(record=>({store:'items',record})));
 const n=list.length;ai.undo=[];ai.changed=[];ai.moved=[];ai.named=0;ai.seen=true;await refresh();redrawCloset?.();render();notify('Undid AI changes to '+plural(n,'piece','pieces')+'.');
}
function askDescribe(ids){
 if(!ids.length)return;
 const left=state.remaining?.tag,short=typeof left==='number'&&left<ids.length;
 if(ids.length<=10&&!short)return describe(ids,{manual:true});
 askConfirm({title:'Describe '+plural(ids.length,'piece','pieces')+' with AI?',tone:'go',
  body:'Each piece’s photo goes to OpenAI, one request per piece'+(typeof left==='number'?' ('+left+' left today'+(short?', so it stops after '+left+'; raise DAILY_TAG_LIMIT to do them all':'')+')':'')+'. AI corrects categories, renames plain names like “ring” and fills empty details. Names and categories you set by hand stay, and you can undo afterwards.',
  keep:'Not now',act:'Describe '+plural(ids.length,'piece','pieces')},()=>describe(ids,{manual:true}));
}
// One status line for uploading and sorting, shown at the top of the Closet.
function statusBanner(){
 const p=intake?.progress()||{},attention=closetPieces().filter(needsFix).length;
 if(p.busy||aiBusy()){
  const up=p.busy?'Adding photos · '+p.finished+' of '+p.total:'Sorting with AI · '+ai.done+' of '+ai.total;
  const max=p.busy?p.total:ai.total,val=p.busy?p.finished:ai.done;
  return '<div class="intake-banner" role="status"><div><strong>'+up+'</strong><span class="hint">'+(ai.stop?'Stopping after the pieces in progress…':ai.manual&&!p.busy?'Fixing categories and plain names. Anything you set by hand stays.':'AI names each piece and puts it in the right category. Keep browsing, or close this.')+'</span></div><progress max="'+max+'" value="'+val+'" aria-label="Progress"></progress>'+(aiBusy()&&!ai.stop?'<button type="button" class="text-btn" id="ai-stop">Stop</button>':'')+'</div>';
 }
 if(p.failed)return '<div class="intake-banner failed" role="alert"><div><strong>'+plural(p.failed,'piece','pieces')+' couldn’t be added</strong><span class="hint">'+esc(intake.state.failed[0].message)+'</span></div><button type="button" class="intake-retry">Retry</button></div>';
 if(ai.total&&!ai.seen){
  const note=[aiDetail(),ai.limit?'Today’s AI limit ran out. Raise DAILY_TAG_LIMIT in Supabase, or describe the rest tomorrow.':'',ai.failed&&ai.lastError?esc(ai.lastError)+'.':'',attention?plural(attention,'piece needs','pieces need')+' a fix.':''].filter(Boolean).join(' ');
  return '<div class="intake-banner '+(ai.limit||ai.failed?'failed':'done')+'" role="status"><div><strong>'+esc(aiHead())+'</strong>'+(note?'<span class="hint">'+note+'</span>':'')+'</div><div class="actions">'+(ai.changed.length?'<button type="button" class="text-btn" id="ai-show">Show changes</button>':'')+(attention?'<button type="button" class="text-btn" id="ai-attention">Show what needs a fix</button>':'')+(ai.undo.length?'<button type="button" class="text-btn" id="ai-undo">Undo</button>':'')+'<button type="button" class="dismiss" id="ai-dismiss" aria-label="Dismiss">×</button></div></div>';
 }
 return '';
}
function closet(tab){
 if(pools[tab]&&tab!==closetTab){closetTab=tab;picked.clear();picking=false}
 const laundry=()=>closetTab==='laundry',pool=()=>pools[closetTab]();
 for(const id of [...picked])if(!pool().some(i=>i.id===id))picked.delete(id);
 if(picked.size)picking=true;
 const filters=['All categories',...categories].map(c=>'<option>'+esc(c)+'</option>').join('')+'<option value="attention">Needs a fix</option>'+(ai.changed.length?'<option value="changed">Changed by AI</option>':'');
 sheet('Closet','<div class="vstack closet"><div class="tabs" role="tablist" aria-label="Closet sections">'+tabButton('closet','Closet',closetPieces().length)+tabButton('laundry','Laundry',laundryItems().length)+'</div><div id="status-slot"></div><div class="row"><label class="field">Search<input type="search" id="item-search" placeholder="Search your closet"></label><label class="field">Category<select id="cat-filter">'+filters+'</select></label></div><div class="actions" id="closet-tools"></div><div id="catalog" class="list-grid" role="tabpanel" aria-labelledby="tab-'+closetTab+'"></div><div id="bulk-bar" class="bulk-bar" hidden></div></div>');
 let shown=[];
 const ordered=()=>shown.filter(i=>picked.has(i.id)).map(i=>i.id).concat([...picked].filter(id=>!shown.some(i=>i.id===id)));
 const bar=()=>{
  const el=$('#bulk-bar');el.hidden=!picking;if(!picking)return;
  const n=picked.size,allShown=shown.length&&shown.every(i=>picked.has(i.id));
  el.innerHTML='<div class="bulk-head"><strong role="status">'+(n?plural(n,'piece','pieces')+' selected':'Tap pieces to select them')+'</strong><div class="actions">'+(shown.length?'<button type="button" class="text-btn" id="pick-all">'+(allShown?'Unselect shown':'Select all shown')+'</button>':'')+(n?'<button type="button" class="text-btn" id="pick-none">Clear</button>':'')+'</div></div>'
   +(n?'<div class="bulk-actions"><label class="field bulk-move"><span class="sr-only">Move selected pieces to category</span><select id="bulk-cat"><option value="" selected disabled>Move to category…</option>'+categories.map(c=>'<option>'+esc(c)+'</option>').join('')+'</select></label><button type="button" id="bulk-apply" disabled>Move</button>'+(laundry()?'<button type="button" id="bulk-available">Mark available</button>':'<button type="button" id="bulk-laundry">Send to laundry</button>')+(state.enabled?'<button type="button" id="bulk-describe" '+(aiBusy()?'disabled':'')+'>Describe with AI</button>':'')+'<button type="button" id="bulk-review">Edit one by one</button><button type="button" id="bulk-delete" class="danger">Delete</button></div>':'');
  on('#pick-all','click',()=>{if(allShown)shown.forEach(i=>picked.delete(i.id));else shown.forEach(i=>picked.add(i.id));draw()});
  on('#pick-none','click',()=>{picked.clear();draw()});
  on('#bulk-cat','change',e=>{$('#bulk-apply').disabled=!e.target.value});
  on('#bulk-apply','click',async()=>{const cat=$('#bulk-cat').value;if(!cat)return;const ids=[...picked];await batch(ids.map(id=>({store:'items',record:{...items.find(i=>i.id===id),category:cat,categoryLocked:true,intake:undefined}})));await refresh();draw();render();notify('Moved '+plural(ids.length,'piece','pieces')+' to '+cat+'.')});
  on('#bulk-available','click',async()=>{const ids=[...picked],n=await setStatus(ids,'available');for(const id of ids)picked.delete(id);draw();render();notify(plural(n,'piece is','pieces are')+' available again.')});
  on('#bulk-laundry','click',async()=>{const ids=[...picked],n=await setStatus(ids,'laundry');for(const id of ids)picked.delete(id);draw();render();notify(plural(n,'piece','pieces')+' moved to Laundry.')});
  on('#bulk-describe','click',()=>askDescribe(ordered()));
  on('#bulk-review','click',()=>{const ids=ordered();if(ids.length)edit(ids)});
  on('#bulk-delete','click',()=>askDelete([...picked],draw));
 };
 const draw=()=>{
  if(!$('#catalog'))return;
  $('#status-slot').innerHTML=statusBanner();
  document.querySelectorAll('.intake-retry').forEach(b=>b.onclick=()=>{intake.retry();updatePill();draw()});
  on('#ai-stop','click',()=>{ai.stop=true;draw()});
  on('#ai-dismiss','click',()=>{ai.seen=true;draw()});
  on('#ai-undo','click',undoAI);
  on('#ai-show','click',()=>{if(!$('#cat-filter [value=changed]'))$('#cat-filter').insertAdjacentHTML('beforeend','<option value="changed">Changed by AI</option>');$('#cat-filter').value='changed';draw()});
  on('#ai-attention','click',()=>{$('#cat-filter').value='attention';draw()});
  for(const k in pools)$('#tab-'+k+' .count').textContent=pools[k]().length;
  const query=$('#item-search').value.toLowerCase().trim(),cat=$('#cat-filter').value,list=pool();
  const match=i=>cat==='All categories'||(cat==='attention'?needsFix(i):cat==='changed'?ai.changed.includes(i.id):cat===i.category);
  shown=list.filter(i=>match(i)&&[i.name,i.category,i.color,i.status,i.material,i.pattern].some(v=>String(v||'').toLowerCase().includes(query)));
  $('#closet-tools').innerHTML=(laundry()
   ?(list.length?'<button type="button" class="primary" id="laundry-done">Laundry done · Mark all available</button>':'')
   :'<button type="button" id="add-item" class="primary">'+icon('plus')+'Add pieces</button>')+(list.length?'<button type="button" id="pick-mode" aria-pressed="false">Select</button>':'')+'<span id="item-count" class="hint"></span>';
  on('#laundry-done','click',async()=>{const n=await setStatus(laundryItems().map(i=>i.id),'available');picked.clear();picking=false;draw();render();notify(plural(n,'piece is','pieces are')+' back in your closet.')});
  const mode=$('#pick-mode');if(mode){mode.setAttribute('aria-pressed',String(picking));mode.textContent=picking?'Done selecting':'Select'}
  $('#item-count').textContent=list.length?plural(shown.length,'piece','pieces'):'';
  on('#add-item','click',uploadStart);
  on('#pick-mode','click',()=>{picking=!picking;if(!picking)picked.clear();draw();$('#pick-mode').focus()});
  const pill=i=>i.intake?'<span class="pill tile-pill new">Sorting…</span>':!categories.includes(i.category)?'<span class="pill tile-pill warn">Needs category</span>':'';
  const tile=i=>{const on=picked.has(i.id);return '<button type="button" class="tile'+(picking?' pickable':'')+(on?' picked':'')+'" '+(picking?'data-pick="'+i.id+'" aria-pressed="'+on+'"':'data-open="'+i.id+'"')+'>'+(picking?'<span class="tick" aria-hidden="true"></span>':'')+pill(i)+'<img alt="" src="'+esc(source(i.photos[0]))+'"><strong>'+esc(i.name)+'</strong><small>'+(i.category?esc(i.category):'No category yet')+(i.status!=='available'?' · '+esc(i.status):'')+'</small></button>'};
  $('#catalog').innerHTML=shown.length?shown.map(tile).join(''):'<div class="empty-note">'+(list.length?(cat==='attention'?'Nothing needs a fix.':'No matching pieces.'):laundry()?'Nothing in the wash. When you mark a look as worn, its tops, bottoms and dresses land here.':'Add photos of your pieces. AI names and sorts each one for you.')+'</div>';
  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=wrap(()=>edit([b.dataset.open])));
  document.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{const id=b.dataset.pick;picked.has(id)?picked.delete(id):picked.add(id);const on=picked.has(id);b.classList.toggle('picked',on);b.setAttribute('aria-pressed',String(on));bar()});
  bar();
 };
 const tabs=[...document.querySelectorAll('[data-tab]')];
 tabs.forEach(t=>{t.onclick=()=>closet(t.dataset.tab);t.onkeydown=e=>{if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;e.preventDefault();const next=tabs[(tabs.indexOf(t)+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];closet(next.dataset.tab);$('#tab-'+next.dataset.tab)?.focus()}});
 on('#item-search','input',draw);on('#cat-filter','change',draw);draw();
 redrawCloset=draw;
}
const accepts='image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif';
function dropZone(id,label){return '<label class="drag" id="'+id+'-drop">'+esc(label)+'<input type="file" id="'+id+'" multiple accept="'+accepts+'"></label>'}
function bindDrop(id,fn){const el=$('#'+id+'-drop');on('#'+id,'change',e=>fn([...e.target.files]));el.ondragover=e=>{e.preventDefault();el.classList.add('over')};el.ondragleave=()=>el.classList.remove('over');el.ondrop=wrap(async e=>{e.preventDefault();el.classList.remove('over');await fn([...e.dataTransfer.files])})}
// Photos upload in the background and AI sorts each piece as it lands. Nothing to review.
function uploadStart(){
 sheet('Add pieces','<div class="vstack"><label class="field">These photos show<select id="batch-mode"><option value="separate">A different piece in each photo</option><option value="angles">Multiple angles of one piece</option></select></label>'+dropZone('new-files','Drop photos here, or choose files')+'<p class="hint">'+(canTag()?'Photos upload in the background. AI names each piece, puts it in the right category and fills in its details. Tap any piece later to fix a mistake.':state.enabled?'Today’s AI limit has run out, so new pieces arrive without a category. Tap a piece to add one, or describe them with AI tomorrow.':'Paid AI is off, so new pieces arrive without a category. Tap a piece to add one.')+' iPhone HEIC photos work.</p><p id="inline-error" class="error" role="alert"></p></div>');
 bindDrop('new-files',async files=>{
  if(!files.length)return;
  const pieces=planPieces(files,$('#batch-mode').value,uid);intake.add(pieces);ai.seen=false;closetTab='closet';closet('closet');updatePill();
 });
}
const fields=['name','category','status'];
const aiKeys=['aiDescription','colors','shades'];
// Edits one piece, or several one after another when you select them. Each piece is saved when you move on.
// You see the photo, name and category; the AI-written description behind them is kept for the stylist.
function edit(ids,{index=0}={}){
 ids=ids.filter(id=>items.some(i=>i.id===id));if(!ids.length)return;
 let edits={},fromAI={};
 const show=i=>{edits={};fromAI={};index=Math.max(0,Math.min(i,ids.length-1));draw()};
 const back=()=>closet(closetTab);
 const finish=()=>{back();notify(ids.length>1?'Saved '+plural(ids.length,'piece','pieces')+'.':'Closet updated.')};
 const title=()=>ids.length===1?'Edit piece':'Edit piece '+(index+1)+' of '+ids.length;
 const values=()=>{const form=$('#edit-form');return form?Object.fromEntries(fields.map(k=>[k,String(new FormData(form).get(k)??'')])):{}};
 const changed=(it,v)=>fields.some(k=>String(v[k]??'')!==String(it[k]??''))||Object.keys(fromAI).length>0;
 async function save(it){
  const v=values(),name=v.name.trim();
  if(!name)throw Error('Give this piece a name.');
  if(!changed(it,v))return;
  // What you set by hand wins over AI from now on.
  // Compared with what AI suggested, if you asked it; otherwise with what was saved.
  const byHand=(k,val)=>val!==String((k in fromAI?fromAI[k]:it[k])??'');
  await put('items',{...it,...fromAI,...v,name,intake:undefined,...(byHand('category',v.category)?{categoryLocked:true}:{}),...(byHand('name',name)?{nameLocked:true}:{})});await refresh();
 }
 function draw(){
  const id=ids[index],it=items.find(x=>x.id===id);
  if(!it){ids.splice(index,1);if(!ids.length)return back();return show(index)}
  const d={...it,...fromAI,...edits},last=index===ids.length-1;
  const nav=(index>0?'<button type="button" id="prev-piece">Previous</button>':'');
  const catOptions=(d.category?'':'<option value="" selected disabled>Choose a category</option>')+options(categories,d.category);
  sheet(title(),'<form id="edit-form" class="vstack" novalidate><div class="photo-strip">'+d.photos.map((pid,n)=>'<div><img alt="Piece angle '+(n+1)+'" src="'+esc(assets.has(pid)?source(pid):'')+'">'+(d.photos.length>1?'<button type="button" class="text-btn" data-remove-angle="'+pid+'">Remove</button>':'')+'</div>').join('')+'</div>'
   +(it.intake?'<p class="hint" role="status">AI is still sorting this piece. Anything you change here stays.</p>':'')
   +'<label class="field">Name<input name="name" maxlength="120" required value="'+esc(d.name)+'"></label><label class="field">Category<select name="category">'+catOptions+'</select></label>'
   +(Object.keys(fromAI).length?'<p class="hint" role="status">Updated by AI. Save to keep it.</p>':'')
   +'<details class="settings"><summary>More</summary><div class="vstack"><label class="field">Status<select name="status">'+options(['available','laundry','unavailable','archived'],d.status)+'</select></label><label class="field">Add photos of other angles<input type="file" id="more-angles" multiple accept="'+accepts+'"></label>'+(state.enabled?'<div class="actions"><button type="button" id="tag-photo">Ask AI to describe it again</button></div><div id="tag-results" aria-live="polite"></div>':'')+'</div></details>'
   +'<p id="inline-error" role="alert" class="error"></p><div class="form-foot">'+nav+'<button class="primary">'+(ids.length===1?'Save':last?'Save &amp; finish':'Save &amp; next')+'</button><button type="button" id="back-closet">Cancel</button><button type="button" id="delete-item" class="danger">Delete piece</button></div></form>');
  guard={dirty:()=>$('#edit-form')?changed(it,values()):false,summary:()=>'Your changes to this piece haven’t been saved.'+(ids.length>1?' Pieces you already saved are kept.':'')};
  const keep=()=>{edits={...edits,...values()}};
  document.querySelectorAll('[data-remove-angle]').forEach(b=>b.onclick=wrap(async()=>{keep();await put('items',{...it,photos:it.photos.filter(p=>p!==b.dataset.removeAngle)});await collectAssets();await refresh();draw()}));
  on('#more-angles','change',async e=>{const files=[...e.target.files];keep();const add=[];for(const [n,f] of files.entries()){notify('Preparing photo '+(n+1)+' of '+files.length+'…');const r=await photoRecord(f);await uploadPhoto(r);add.push(r.id)}const latest=items.find(x=>x.id===id);await put('items',{...latest,photos:[...new Set([...latest.photos,...add])]});await refresh();draw()});
  on('#prev-piece','click',async()=>{await save(it);show(index-1)});
  on('#back-closet','click',()=>requestClose(back));
  on('#delete-item','click',()=>askDelete([id],()=>{ids.splice(index,1);if(!ids.length)return back();show(index)}));
  on('#tag-photo','click',async e=>{const btn=e.currentTarget,seq=dialogSeq;btn.disabled=true;btn.textContent='Looking at the photo…';try{
   keep();const label=genericName(edits.name??it.name)||vagueName(edits.name??it.name)?'':(edits.name??it.name);
   const {suggestions}=await request('tag',{image:await referenceJPEG(await assetBlob(it.photos[0])),...(label?{label}:{})});if(seq!==dialogSeq)return;if(!Array.isArray(suggestions)||!suggestions.length)throw Error('AI couldn’t make out a piece in this photo.');
   // Asking again refreshes the hidden description and fixes the name and category, as if you had chosen them.
   const apply=sug=>{const {record}=describedRecord({...it,name:edits.name??it.name,category:edits.category??it.category,nameLocked:false,categoryLocked:false},sug,{categories,refresh:true});fromAI=Object.fromEntries(['name','category',...aiKeys].filter(k=>record[k]!==undefined).map(k=>[k,record[k]]));fromAI.name=sug.name||fromAI.name;edits={...edits,name:fromAI.name,category:fromAI.category??edits.category}};
   apply(suggestions[0]);draw();
   if(suggestions.length>1){const target=$('#tag-results');target.innerHTML='<p class="hint">This photo shows '+suggestions.length+' pieces. Using “'+esc(suggestions[0].name)+'”.</p><div class="actions">'+suggestions.slice(1).map((sg,i)=>'<button type="button" data-sug="'+(i+1)+'">Use “'+esc(sg.name)+'” instead</button>').join('')+'<button type="button" id="split">Add the others as separate pieces</button></div>';
    target.closest('details').open=true;
    target.querySelectorAll('[data-sug]').forEach(b=>b.onclick=()=>{apply(suggestions[Number(b.dataset.sug)]);draw()});
    on('#split','click',async()=>{const extra=suggestions.slice(1).map((sg,n)=>{const {record}=describedRecord({...it,id:uid(),name:'',category:'',aiDescription:'',colors:[],shades:[],intake:undefined,nameLocked:false,categoryLocked:false,created:(it.created||Date.now())+(n+1)/100},sg,{categories});return record});await batch(extra.map(record=>({store:'items',record})));await refresh();notify('Added '+plural(extra.length,'more piece','more pieces')+' from this photo.');$('#tag-results').innerHTML=''})}
  }finally{if(btn.isConnected){btn.disabled=false;btn.textContent='Ask AI to describe it again'}}});
  on('#edit-form','submit',async e=>{e.preventDefault();await save(it);guard=null;if(last)finish();else show(index+1)});
 }
 draw();
}
function skinRow(){
 const k=settings.skin,head=refs.find(r=>r.id==='head-front'),body=refs.find(r=>r.id==='body-front');if(!head)return '';
 const fresh=k&&k.ref===head.photo+'|'+(body?.photo||'')&&k.hairLength!==undefined;
 const hair=fresh?[k.hairLength,k.hairColor,k.hairTexture].filter(Boolean).join(', '):'';
 return '<div class="skin-row"><span class="swatch big" style="background:'+(fresh&&/^#[0-9a-f]{6}$/i.test(k.hex||'')?k.hex:'transparent')+'" aria-hidden="true"></span><div><strong>Skin &amp; hair, for makeup and hairstyles</strong><small>'+(fresh?esc([k.depth,k.undertone&&k.undertone+' undertone'].filter(Boolean).join(', '))+(hair?'<br>Hair: '+esc(hair):''):state.enabled?'Read from your photos the next time you generate a look.':'Read from your photos once paid AI is on.')+'</small></div>'+(fresh&&state.enabled?'<button type="button" class="text-btn" id="skin-redo">Read again</button>':'')+'</div>';
}
function profile(){
 const slots=[...refSlots,...refs.filter(r=>!refSlots.some(([id])=>r.id===id)).map(r=>[r.id,r.label||'Additional reference'])];
 sheet('Appearance references','<div class="vstack"><p class="sheet-copy">A full-body front photo and a front-facing headshot anchor the outfit rendering. Other angles are optional. Photos are saved privately to your account and sent to OpenAI only when you render a look.</p><div>'+slots.map(([id,label,required])=>{const r=refs.find(x=>x.id===id);return '<div class="ref-row">'+(r?'<img alt="'+esc(label)+'" src="'+esc(source(r.photo))+'">':'<span class="ref-sample" aria-hidden="true">+</span>')+'<div><strong>'+esc(label)+'</strong><small>'+(required?'Required':'Optional')+'</small></div><div class="actions"><button data-pick="'+id+'">'+(r?'Replace':'Upload')+'</button>'+(r?'<button data-delref="'+id+'" aria-label="Delete '+esc(label)+'">×</button>':'')+'</div></div>'}).join('')+'</div>'+skinRow()+'<button id="extra">Add other references</button><button id="sign-out" class="text-btn">Sign out</button><input hidden id="ref-picker" type="file" accept="'+accepts+'"><p class="error" id="inline-error" role="alert"></p></div>');
 const picker=$('#ref-picker');let selected;function pick(id){selected=id;picker.multiple=!id;picker.value='';picker.click()}
 document.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>pick(b.dataset.pick));on('#extra','click',()=>pick(''));
 on('#ref-picker','change',async e=>{const changes=[],files=[...e.target.files];for(const [n,f] of files.entries()){notify('Preparing photo '+(n+1)+' of '+files.length+'…');const record=await photoRecord(f);changes.push({store:'assets',record},{store:'refs',record:{id:selected||uid(),photo:record.id,label:f.name}})}if(!changes.length)return;await batch(changes);await collectAssets();await refresh();profile();render()});
 on('#sign-out','click',async()=>{await signOut();location.reload()});
 on('#skin-redo','click',async e=>{e.currentTarget.disabled=true;await setting('skin',null);await ensureSkin();profile()});
 document.querySelectorAll('[data-delref]').forEach(b=>b.onclick=wrap(async()=>{await remove('refs',b.dataset.delref);await collectAssets();await refresh();profile();render()}));
}
async function navigate(){
 const seq=++navSeq;stopReader();const page=location.hash==='#mirror'?'mirror':location.hash==='#lookbook'?'lookbook':'studio';if(cleanupMirror){cleanupMirror();cleanupMirror=null}close();$('#studio').hidden=page!=='studio';$('#mirror').hidden=page!=='mirror';$('#lookbook').hidden=page!=='lookbook';
 for(const name of ['studio','lookbook','mirror']){const link=$('#nav-'+name);if(name===page)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')}
 if(page==='studio'){render();scrollTo(0,0);return}
 if(page==='lookbook'){lookbookPage();scrollTo(0,0);return}
 try{const {mountMirror}=await import('./mirror.js');if(seq!==navSeq)return;cleanupMirror=mountMirror($('#mirror'),{request:api,getContext:async()=>{await refresh();return context()},onSassChange:value=>setting('sass',Number(value)),autoFrames:pref().autoFrames!==false,onAutoFramesChange:value=>setting('autoFrames',value)})}catch(e){$('#mirror').textContent='Mirror could not open. '+e.message}
}
on('#open-profile','click',()=>{if(ready)profile()});
// Progress outside the Closet: a small pill that opens it.
function updatePill(){
 const el=$('#intake-pill'),p=intake?.progress();if(!el||!p)return;clearTimeout(pillTimer);
 if(redrawCloset&&$('#sheet').open){el.hidden=true;return} // The Closet shows the same progress itself.
 const show=(cls,html)=>{el.hidden=false;el.className='intake-pill'+(cls?' '+cls:'');el.innerHTML=html};
 if(p.busy)return show('','<span class="loading" aria-hidden="true"></span>Adding '+p.finished+' of '+p.total);
 if(aiBusy())return show('','<span class="loading" aria-hidden="true"></span>Sorting '+ai.done+' of '+ai.total);
 if(p.failed)return show('failed',esc(plural(p.failed,'piece','pieces'))+' couldn’t be added · Open');
 if(ai.total&&!ai.seen){show(ai.limit||ai.failed?'failed':'done',esc(aiHead())+(ai.limit?' · AI limit reached':'')+' · View');pillTimer=setTimeout(()=>{el.hidden=true},9000);return}
 el.hidden=true;
}
$('#intake-pill').onclick=()=>{if(ready)closet('closet')};
$('#sheet').addEventListener('close',()=>updatePill());
function onIntake(ev){
 if(intakeTimer&&ev.type!=='idle')return;
 clearTimeout(intakeTimer);
 intakeTimer=setTimeout(async()=>{intakeTimer=null;await refresh();updatePill();redrawCloset?.();if(!intake.busy()&&!aiBusy()&&!$('#sheet').open)render()},ev.type==='idle'?0:350);
}
// New pieces join the closet straight away and AI sorts them; without AI they arrive needing a category.
async function savePiece(record){
 const sort=canTag();await put('items',sort?record:{...record,intake:undefined});
 if(sort)describe([record.id]);
}
function signIn(){
 $('#studio').hidden=false;$('#mirror').hidden=true;
 const body=keyProblem?'<p class="fail" role="alert">'+esc(keyProblem)+'</p>':!configured?'<p class="sheet-copy">Add your Supabase project URL and publishable key to config.js, then reload.</p>':'<p class="sheet-copy">Sign in to open your closet. Your photos and looks are stored privately in your account.</p><form id="signin-form" class="vstack"><label class="field">Email<input type="email" name="email" required autocomplete="email" inputmode="email"></label><button class="primary">Email me a sign-in link</button><p id="inline-error" class="error" role="alert"></p></form>';
 $('#studio').innerHTML='<section class="signin"><div class="studio-head"><h1>The <em>Studio</em></h1></div>'+body+'</section>';
 on('#signin-form','submit',async e=>{e.preventDefault();const form=e.target,btn=form.querySelector('button'),email=String(new FormData(form).get('email')).trim();btn.disabled=true;try{await sendLink(email);form.outerHTML='<p class="sheet-copy" role="status">Sign-in link sent to '+esc(email)+'. Open it on this device to continue.</p>'}finally{btn.disabled=false}});
}
try{
 if(!await currentSession()){signIn()}else{
  await openStore();await Promise.all([refresh(),status()]);
  intake=createIntake({prepare:photoRecord,upload:uploadPhoto,save:savePiece,knownPhoto:id=>items.some(i=>i.photos?.[0]===id),onChange:onIntake});active=looks.some(l=>l.id===settings.activeLook)?settings.activeLook:(looks[0]?.id||'');ready=true;await navigate();
  // Pieces left mid-sort (or from the old Unreviewed list) finish sorting now.
  {const waiting=items.filter(i=>i.intake);const sort=waiting.filter(i=>i.intake==='new'&&canTag()).map(i=>i.id),rest=waiting.filter(i=>!sort.includes(i.id)).map(i=>i.id);if(rest.length)await release(rest);if(sort.length)describe(sort)}window.addEventListener('hashchange',()=>navigate());
  client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')location.reload()});
 }
}catch(e){$('#studio').textContent=e.message||'Your closet could not be opened. Reload to try again.'}
