import {openStore,all,batch,put,remove,photoRecord,referenceJPEG,collectAssets,assetBlob} from './store.js';
import {client,configured,keyProblem,currentSession,sendLink,signOut,api} from './supabase.js';
import {AREAS,SPOT_LABELS,lookAreas,spotsFor,cropStyle,containRect} from './details.js';

const categories=['Tops','Bottoms','Dresses / One-pieces','Outerwear','Shoes','Bags','Jewelry','Other Accessories','Makeup','Full Looks / Outfit References'];
const occasions=['Everyday / Class','Date Night — Attract a Boyfriend','Queer Night Out / Meet a Masc Lesbian','Professional / Get a Job','Coffee Chat / Networking','Make Friends / Approachable','Creative Industry Event','Presenting My Work','Surprise Me','Custom Occasion'];
const refSlots=[['body-front','Full body · front',true],['head-front','Headshot · front',true],['body-side','Full body · side'],['body-back','Full body · back or three-quarter'],['head-left','Headshot · left three-quarter'],['head-right','Headshot · right three-quarter']];
const attrs=[['color','Color'],['material','Material'],['pattern','Pattern'],['silhouette','Silhouette'],['attributes','Styling details'],['productType','Product type'],['shade','Shade'],['finish','Finish'],['notes','Application or item notes']];
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
let held=null,sameRun=false,renderError=null,detailsOn=false,guard=null,spotObserver;const locating=new Set(),unmapped=new Set();
const pref=()=>({...defaults,...settings});
const current=()=>looks.find(l=>l.id===active);
const available=()=>items.filter(i=>i.status==='available'&&i.category!==categories.at(-1)&&i.photos?.length);
const coverage=()=>{const cats=new Set(available().map(i=>i.category));return {shoes:cats.has('Shoes'),base:cats.has(categories[2])||(cats.has('Tops')&&cats.has('Bottoms')),body:refs.some(r=>r.id==='body-front'),face:refs.some(r=>r.id==='head-front')}};
function source(id){return assets.get(id)?.url||''}
function notify(s){$('#notice').textContent=s;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#notice').textContent='',5500)}
async function refresh(){const [i,r,l,s,a]=await Promise.all(['items','refs','looks','settings','assets'].map(all));items=i;refs=r;looks=l.sort((x,y)=>y.created-x.created);settings=Object.fromEntries(s.map(v=>[v.id,v.value]));assets=idMap(a)}
async function setting(id,value){settings[id]=value;await put('settings',{id,value})}
const publicItem=({photos,...item})=>item;
function context(){const p=pref();return {wardrobe:items.map(publicItem),outfit:current()?lookFields(current()):null,preferences:{style:p.style,creativity:p.creativity},occasion:p.occasion,context:p.context,sass:p.sass,feedback:historyFields()}}
function lookFields(l){return {id:l.id,title:l.title,itemIds:l.itemIds,styling:l.styling,makeup:l.makeup,reasoning:l.reasoning,occasion:l.occasion}}
function historyFields(){return looks.slice(0,25).map(l=>({title:l.title,itemIds:l.itemIds,rating:l.rating,feedback:l.feedback,occasion:l.occasion}))}
const request=(path,body)=>api(path,body);
async function status(){try{state=await request('status')}catch{state={enabled:false}}}
function sheet(title,markup){guard=null;dialogSeq++;$('#sheet-title').textContent=title;$('#sheet-body').innerHTML=markup;const d=$('#sheet');if(!d.open)d.showModal();d.scrollTop=0}
function close(){if($('#sheet').open)$('#sheet').close()}
// Every way out of a sheet goes through requestClose, so unsaved upload work is never lost by accident.
function requestClose(proceed=close){if(guard?.dirty()){askDiscard(guard.summary?.()||'',()=>{const g=guard;guard=null;g?.discard?.();proceed()});return}guard=null;proceed()}
function askConfirm({title,body,keep,act},onAct){
 const d=$('#confirm');if(d.open)return;$('#confirm-title').textContent=title;$('#confirm-body').textContent=body;
 const k=$('#keep-reviewing'),a=$('#discard-work');k.textContent=keep;a.textContent=act;
 k.onclick=()=>d.close();a.onclick=()=>{d.close();onAct()};
 d.showModal();k.focus();
}
const askDiscard=(summary,onDiscard)=>askConfirm({title:'Discard unsaved work?',body:summary+' Pieces already in your closet stay as they are.',keep:'Keep reviewing',act:'Discard unsaved work'},onDiscard);
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
addEventListener('beforeunload',e=>{if(sheetEl.open&&guard?.dirty()){e.preventDefault();e.returnValue=''}});
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
function details(l){
 const pieces=l.itemIds.map(id=>{const it=items.find(i=>i.id===id);return it?'<div class="item-chip"><img src="'+esc(source(it.photos[0]))+'" alt=""><span>'+esc(it.name)+'</span></div>':'<span class="hint">Deleted closet item</span>'}).join('');
 return '<section class="look-card"><span class="micro">Look notes</span><h2>'+esc(l.title)+'</h2><div class="actions"><button type="button" id="save-look" '+(l.saved?'disabled':'')+'>'+(l.saved?'Saved to lookbook':'Save look')+'</button><button type="button" id="rate-look">Rate after wearing</button>'+(l.image&&!busy&&renderError?.id!==l.id?'<button type="button" class="text-btn" id="regenerate" '+(state.enabled?'':'disabled')+'>Regenerate image</button>':'')+'</div>'
  +'<details class="settings" data-keep="why"><summary>Why this look</summary><div><p>'+esc(l.reasoning)+'</p></div></details>'
  +'<details class="settings" data-keep="pieces"><summary>Pieces · '+l.itemIds.length+'</summary><div class="item-strip">'+pieces+'</div></details>'
  +'<details class="settings" data-keep="steps"><summary>Styling &amp; makeup</summary><div><p>'+esc(l.styling)+'</p><p>'+esc(l.makeup)+'</p></div></details></section>';
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
 on('#save-look','click',async()=>{const l=current();await put('looks',{...l,saved:true});await refresh();refreshLook();notify('Saved to your lookbook.')});on('#rate-look','click',rate);
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
 sheet(area.title,'<div class="vstack area-sheet">'+view+notes+pieces+'</div>');
}
function render(){
 if(!ready)return;
 const s=pref(),l=current(),c=coverage(),canGenerate=state.enabled&&c.base&&c.shoes&&c.body&&c.face,restore=keepOpen($('#studio'));
 $('#studio').innerHTML='<div class="studio-head"><h1>The <em>Studio</em></h1><div class="studio-actions"><button id="closet">'+icon('closet')+'Closet</button><button id="looks">'+icon('history')+'Lookbook</button></div></div><div class="editor"><div id="look-col">'+lookColumn(l)+'</div><section class="brief"><div class="brief-top"><h2>Styling brief</h2>'+icon('spark')+'</div><label class="field">Dressing for<select id="occasion">'+options(occasions,s.occasion)+'</select></label><label class="field"><span>Today’s context <small> · optional</small></span><textarea id="day-context" maxlength="1400" placeholder="Weather, dress code, plans, comfort…">'+esc(s.context)+'</textarea></label><details class="settings" data-keep="prefs"><summary>Styling preferences</summary><div>'+slider('creativity','Experimentation',s.creativity,1,10)+slider('sass','Sass',s.sass,0,4)+'<label class="field">Personal style<input id="style" value="'+esc(s.style)+'" maxlength="700" placeholder="What should the stylist remember?"></label></div></details><button class="primary" id="generate" '+(!canGenerate||busy?'disabled':'')+'>'+(busy?'<span class="loading"></span>Working on your look…':(l?'Generate new outfit':'Generate outfit')+icon('arrow'))+'</button>'+(canGenerate?'<p class="action-note">Uses one styling request and one image request. '+esc(state.remaining?.image??'—')+' image requests left today.</p>':'')+(failure?'<p role="alert" class="fail">'+esc(failure)+'</p>':'')+setupMarkup()+'</section></div>';
 on('#closet','click',closet);on('#looks','click',lookbook);on('#occasion','change',e=>setting('occasion',e.target.value));on('#day-context','input',e=>setting('context',e.target.value));on('#style','input',e=>setting('style',e.target.value));
 for(const id of ['creativity','sass'])wireSlider(id);
 on('#generate','click',()=>runLook(false));restore();wireLook();
 document.querySelectorAll('[data-setup]').forEach(b=>b.onclick=wrap(()=>({closet,profile,api:apiInfo})[b.dataset.setup]()));
}
function slider(id,label,value,min,max){return '<label class="field"><span>'+label+' · <output id="'+id+'-value">'+value+'</output> / '+max+'</span><input id="'+id+'" type="range" min="'+min+'" max="'+max+'" value="'+value+'"></label>'}
function wireSlider(id){on('#'+id,'input',async e=>{const value=+e.target.value;$('#'+id+'-value').value=value;await setting(id,value)})}
function apiInfo(){sheet('AI services','<div class="vstack"><p class="sheet-copy">'+(state.enabled?'AI is connected.':'AI is off. In Supabase, add OPENAI_API_KEY and set ENABLE_PAID_API to true in the function secrets, then refresh.')+'</p><p class="sheet-copy">Selecting a look sends wardrobe descriptions and recent feedback. Rendering sends the chosen garment images and appearance references. Tagging sends the photo you choose.</p><div class="actions"><button id="check-api">Refresh connection</button></div></div>');on('#check-api','click',async()=>{await status();apiInfo();render()})}
async function visualize(l){
 await refresh();const checked=l.itemIds.map(id=>items.find(i=>i.id===id&&i.status==='available'&&i.photos?.length));if(checked.some(i=>!i))throw Error('An item in this look is no longer available. Choose a new outfit.');
 const front=refs.find(r=>r.id==='body-front'),head=refs.find(r=>r.id==='head-front');if(!front||!head)throw Error('Add a front-facing full-body photo and a headshot to visualize this look.');
 const img=async id=>referenceJPEG(await assetBlob(id));
 const body={items:await Promise.all(checked.map(async i=>({...publicItem(i),image:await img(i.photos[0])}))),look:lookFields(l),appearance:await Promise.all([front,head,...['body-side','head-left'].map(id=>refs.find(r=>r.id===id)).filter(Boolean)].map(r=>img(r.photo)))};
 const response=await request('image',body);
 if(typeof response.image!=='string'||!response.image.startsWith('data:image/'))throw Error('The image provider returned no usable image. The outfit is still available.');
 await refresh();const latest=looks.find(i=>i.id===l.id);if(!latest)return;
 await put('looks',{...latest,image:response.image,renderFailed:false,hotspots:null,imagePrompt:response.prompt,imageModel:response.model});
}
function revealViewer(){const v=$('#viewer');if(!v)return;const r=v.getBoundingClientRect();if(r.top<0||r.top>innerHeight*0.5)v.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})}
async function runLook(imageOnly){
 if(busy)return;failure='';renderError=null;detailsOn=false;held=current()?.image||null;sameRun=imageOnly;
 busy=imageOnly?'render':'select';render();revealViewer();live(imageOnly?'Rendering your look…':'Selecting pieces…');
 let mapped=null;
 try{
  await refresh();let l=current();if(!imageOnly){
   const p=pref();if(p.occasion==='Custom Occasion'&&!p.context.trim())throw Error('Describe your custom occasion in today’s context.');const result=await request('select',{items:available().map(publicItem),occasion:p.occasion,context:p.context,preferences:p.style,history:historyFields(),sass:p.sass,creativity:p.creativity});
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
function lookbook(){
 const rows=looks.map(l=>'<div class="history-row">'+(l.image?'<img alt="" src="'+esc(l.image)+'">':'<span class="history-blank"></span>')+'<div class="history-title"><strong>'+esc(l.title)+'</strong><small>'+esc(l.occasion)+' · '+(l.saved?'Saved':'Generated')+(l.rating?' · '+l.rating+'/5':'')+'</small></div><button data-view="'+l.id+'">View</button><button data-drop="'+l.id+'" aria-label="Remove '+esc(l.title)+'">×</button></div>').join('');
 sheet('Lookbook','<div class="vstack">'+(rows||'<div class="empty-note">Your generated looks and wear ratings will appear here.</div>')+'</div>');
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=wrap(async()=>{active=b.dataset.view;detailsOn=false;renderError=null;await setting('activeLook',active);close();render()}));
 document.querySelectorAll('[data-drop]').forEach(b=>b.onclick=()=>{const id=b.dataset.drop;askConfirm({title:'Delete this look?',body:'Its preview, notes and rating are removed. Your closet pieces stay. This can’t be undone.',keep:'Keep look',act:'Delete look'},wrap(async()=>{await remove('looks',id);await refresh();if(active===id){active=looks[0]?.id||'';await setting('activeLook',active)}lookbook();render()}))});
}
function rate(){const l=current();sheet('After wearing','<form id="feedback" class="vstack"><label class="field">Rating<select name="rating" required><option value="">Choose a rating</option>'+[1,2,3,4,5].map(v=>'<option value="'+v+'" '+(v===l.rating?'selected':'')+'>'+v+' / 5</option>').join('')+'</select></label><label class="field">What worked or missed?<textarea name="feedback" maxlength="1000">'+esc(l.feedback)+'</textarea></label><button class="primary">Save feedback</button></form>');on('#feedback','submit',async e=>{e.preventDefault();const f=new FormData(e.target);const latest=(await all('looks')).find(x=>x.id===l.id);if(!latest)throw Error('This look has been removed.');await put('looks',{...latest,rating:Number(f.get('rating')),feedback:f.get('feedback')});await refresh();close();notify('Feedback saved for future styling requests.')})}
let picking=false;const picked=new Set();
function closet(){
 for(const id of [...picked])if(!items.some(i=>i.id===id))picked.delete(id);
 if(picked.size)picking=true;
 sheet('Closet','<div class="vstack closet"><div class="row"><label class="field">Search<input type="search" id="item-search" placeholder="Search your closet"></label><label class="field">Category<select id="cat-filter">'+options(['All categories',...categories],'All categories')+'</select></label></div><div class="actions"><button type="button" id="add-item" class="primary">'+icon('plus')+'Add pieces</button><button type="button" id="pick-mode" aria-pressed="false">Select</button><span id="item-count" class="hint"></span></div><div id="catalog" class="list-grid"></div><div id="bulk-bar" class="bulk-bar" hidden></div></div>');
 let shown=[];
 const bar=()=>{
  const el=$('#bulk-bar');el.hidden=!picking;if(!picking)return;
  const n=picked.size,allShown=shown.length&&shown.every(i=>picked.has(i.id));
  el.innerHTML='<div class="bulk-head"><strong role="status">'+(n?plural(n,'piece','pieces')+' selected':'Tap pieces to select them')+'</strong><div class="actions">'+(shown.length?'<button type="button" class="text-btn" id="pick-all">'+(allShown?'Unselect shown':'Select all shown')+'</button>':'')+(n?'<button type="button" class="text-btn" id="pick-none">Clear</button>':'')+'</div></div>'
   +(n?'<div class="bulk-actions"><label class="field bulk-move"><span class="sr-only">Move selected pieces to category</span><select id="bulk-cat"><option value="" selected disabled>Move to category…</option>'+categories.map(c=>'<option>'+esc(c)+'</option>').join('')+'</select></label><button type="button" id="bulk-apply" disabled>Move</button><button type="button" id="bulk-review">Review</button><button type="button" id="bulk-delete" class="danger">Delete</button></div>':'');
  on('#pick-all','click',()=>{if(allShown)shown.forEach(i=>picked.delete(i.id));else shown.forEach(i=>picked.add(i.id));draw()});
  on('#pick-none','click',()=>{picked.clear();draw()});
  on('#bulk-cat','change',e=>{$('#bulk-apply').disabled=!e.target.value});
  on('#bulk-apply','click',async()=>{const cat=$('#bulk-cat').value;if(!cat)return;const ids=[...picked];await batch(ids.map(id=>({store:'items',record:{...items.find(i=>i.id===id),category:cat}})));await refresh();draw();render();notify('Moved '+plural(ids.length,'piece','pieces')+' to '+cat+'.')});
  on('#bulk-review','click',()=>{const chosen=items.filter(i=>picked.has(i.id)).map(i=>({...i}));if(chosen.length)editItems(chosen,[],true)});
  on('#bulk-delete','click',()=>askDelete([...picked],draw));
 };
 const draw=()=>{
  const query=$('#item-search').value.toLowerCase().trim(),cat=$('#cat-filter').value;
  shown=items.filter(i=>(cat==='All categories'||cat===i.category)&&[i.name,i.category,i.color,i.status,i.material,i.pattern].some(v=>String(v||'').toLowerCase().includes(query)));
  const mode=$('#pick-mode');mode.setAttribute('aria-pressed',String(picking));mode.textContent=picking?'Done selecting':'Select';
  $('#item-count').textContent=plural(shown.length,'piece','pieces');
  const tile=i=>{const on=picked.has(i.id);return '<button type="button" class="tile'+(picking?' pickable':'')+(on?' picked':'')+'" '+(picking?'data-pick="'+i.id+'" aria-pressed="'+on+'"':'data-item="'+i.id+'"')+'>'+(picking?'<span class="tick" aria-hidden="true"></span>':'')+'<img alt="" src="'+esc(source(i.photos[0]))+'"><strong>'+esc(i.name)+'</strong><small>'+esc(i.category)+(i.status!=='available'?' · '+esc(i.status):'')+'</small></button>'};
  $('#catalog').innerHTML=shown.length?shown.map(tile).join(''):'<div class="empty-note">'+(items.length?'No matching pieces.':'Add your first piece to start your closet.')+'</div>';
  document.querySelectorAll('[data-item]').forEach(b=>b.onclick=wrap(()=>editItems([{...items.find(i=>i.id===b.dataset.item)}],[],true)));
  document.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{const id=b.dataset.pick;picked.has(id)?picked.delete(id):picked.add(id);const on=picked.has(id);b.classList.toggle('picked',on);b.setAttribute('aria-pressed',String(on));bar()});
  bar();
 };
 on('#pick-mode','click',()=>{picking=!picking;if(!picking)picked.clear();draw();$('#pick-mode').focus()});
 on('#item-search','input',draw);on('#cat-filter','change',draw);on('#add-item','click',uploadStart);draw();
}
const accepts='image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif';
function dropZone(id,label){return '<label class="drag" id="'+id+'-drop">'+esc(label)+'<input type="file" id="'+id+'" multiple accept="'+accepts+'"></label>'}
function bindDrop(id,fn){const el=$('#'+id+'-drop');on('#'+id,'change',e=>fn([...e.target.files]));el.ondragover=e=>{e.preventDefault();el.classList.add('over')};el.ondragleave=()=>el.classList.remove('over');el.ondrop=wrap(async e=>{e.preventDefault();el.classList.remove('over');await fn([...e.dataTransfer.files])})}
function uploadStart(){
 sheet('Add to closet','<div class="vstack"><label class="field">These photos show<select id="batch-mode"><option value="separate">A different piece in each photo</option><option value="angles">Multiple angles of one piece</option></select></label>'+dropZone('new-files','Drop photos here, or choose files')+'<p id="intake-status" class="hint" role="status" aria-live="polite"></p><p class="hint">You’ll review each piece before it’s added. iPhone HEIC photos work.</p><p id="inline-error" class="error" role="alert"></p></div>');
 let preparing=0;guard={dirty:()=>preparing>0,summary:()=>'Your photos are still being prepared and haven’t been added yet.'};
 bindDrop('new-files',async files=>{if(!files.length)return;const mode=$('#batch-mode').value,seq=dialogSeq;$('#new-files').disabled=true;preparing=files.length;try{
  const records=[],status=$('#intake-status');for(const [n,file] of files.entries()){if(status)status.textContent='Preparing photo '+(n+1)+' of '+files.length+'…';const r=await photoRecord(file);if(!records.some(x=>x.id===r.id))records.push({...r,name:file.name.replace(/\.[^/.]+$/,'').replace(/[_-]/g,' ')})}if(status)status.textContent='';
  if(seq!==dialogSeq)return;
  const recordGroups=mode==='angles'?[records]:records.map(r=>[r]);const drafts=recordGroups.map(group=>({id:uid(),name:group[0].name,photos:group.map(r=>r.id),category:categories[0],status:'available'}));
  editItems(drafts,records,false);
 }finally{preparing=0;if($('#new-files'))$('#new-files').disabled=false;const st=$('#intake-status');if(st)st.textContent=''}});
}
function editItems(drafts,originals,editing,index=0,base=JSON.stringify(drafts)){
 const d=drafts[index];const local=new Map(originals.map(o=>[o.id,o]));const viewUrls=[];
 const display=id=>{if(assets.has(id))return source(id);const blob=local.get(id)?.blob;if(!blob)return '';const url=URL.createObjectURL(blob);viewUrls.push(url);return url};
 const free=()=>{for(const u of viewUrls)URL.revokeObjectURL(u)};
 sheet(editing&&drafts.length===1?'Edit piece':'Review '+(drafts.length>1?'piece '+(index+1)+' of '+drafts.length:'piece'),'<form id="edit-form" class="vstack"><div class="photo-strip">'+d.photos.map((id,n)=>'<div><img alt="Piece angle '+(n+1)+'" src="'+esc(display(id))+'">'+(d.photos.length>1?'<button type="button" class="text-btn" data-remove-angle="'+id+'">Remove</button>':'')+'</div>').join('')+'</div><details class="settings"><summary>More photos of this piece</summary><div><label class="field">Add angles<input type="file" id="more-angles" multiple accept="'+accepts+'"></label></div></details>'+(state.enabled?'<div class="actions"><button type="button" id="tag-photo">Suggest attributes with AI</button><span class="hint">Sends the first photo for analysis.</span></div>':'')+'<div id="tag-results" aria-live="polite"></div><label class="field">Item name<input name="name" maxlength="120" required value="'+esc(d.name)+'"></label><div class="grid2"><label class="field">Category<select name="category">'+options(categories,d.category)+'</select></label><label class="field">Status<select name="status">'+options(['available','laundry','unavailable','archived'],d.status)+'</select></label></div><details class="settings" '+(editing?'open':'')+'><summary>Attributes &amp; makeup details</summary><div class="grid2">'+attrs.map(([k,l])=>'<label class="field">'+l+'<input name="'+k+'" maxlength="500" value="'+esc(d[k])+'"></label>').join('')+'</div></details><p id="inline-error" role="alert" class="error"></p><div class="form-foot"><button class="primary">'+(index<drafts.length-1?'Review next piece':editing?(drafts.length>1?'Save '+drafts.length+' pieces':'Save changes'):drafts.length>1?'Add '+drafts.length+' pieces':'Add to closet')+'</button><button type="button" id="back-closet">Cancel</button>'+(editing&&drafts.length===1?'<button type="button" id="delete-item" class="danger">Delete piece</button>':'')+'</div></form>');
 const seq=dialogSeq;
 $('#sheet').addEventListener('close',free,{once:true});
 const read=()=>Object.assign(d,Object.fromEntries(new FormData($('#edit-form'))));
 const again=()=>{free();editItems(drafts,originals,editing,index,base)};
 const count=drafts.length;
 guard={dirty:()=>{if(!$('#edit-form'))return false;read();return !editing||JSON.stringify(drafts)!==base},discard:free,
  summary:()=>editing?(count===1?'Your changes to this piece haven’t been saved.':'Your changes to these '+count+' pieces haven’t been saved.'):count===1?'This piece and its photos haven’t been added to your closet.':'These '+count+' pieces and their photos haven’t been added to your closet.'};
 document.querySelectorAll('[data-remove-angle]').forEach(b=>b.onclick=wrap(()=>{read();d.photos=d.photos.filter(p=>p!==b.dataset.removeAngle);again()}));
 on('#more-angles','change',async e=>{const files=[...e.target.files];read();const add=[];for(const [n,f] of files.entries()){notify('Preparing photo '+(n+1)+' of '+files.length+'…');add.push(await photoRecord(f))}if(seq!==dialogSeq)return;for(const r of add)if(!d.photos.includes(r.id)){d.photos=[...d.photos,r.id];originals.push(r)}again()});
 on('#back-closet','click',()=>requestClose(()=>{free();closet()}));
 on('#delete-item','click',()=>askDelete([d.id],()=>{free();closet()}));
 on('#tag-photo','click',async e=>{const btn=e.currentTarget;btn.disabled=true;btn.textContent='Analyzing photo…';try{
  const blob=local.get(d.photos[0])?.blob||await assetBlob(d.photos[0]);
  const {suggestions}=await request('tag',{image:await referenceJPEG(blob)});if(seq!==dialogSeq)return;if(!Array.isArray(suggestions)||!suggestions.length)throw Error('No clear item was detected. Enter its attributes manually.');
  const target=$('#tag-results');target.innerHTML='<span class="section-label">Suggested pieces</span><p class="hint">Choose one to fill the current record.'+(suggestions.length>1&&!editing?' You can also review each as a separate piece.':'')+'</p><div class="actions">'+suggestions.map((s,i)=>'<button type="button" data-sug="'+i+'">'+esc(s.name)+'</button>').join('')+(suggestions.length>1&&!editing?'<button type="button" id="split">Review all as separate pieces</button>':'')+'</div>';
  function apply(rec,s){for(const k of ['name','category',...attrs.map(a=>a[0])])if(typeof s[k]==='string'&&(k!=='category'||categories.includes(s[k])))rec[k]=s[k]}
  target.querySelectorAll('[data-sug]').forEach(b=>b.onclick=wrap(()=>{read();apply(d,suggestions[Number(b.dataset.sug)]);again()}));
  on('#split','click',()=>{read();const records=suggestions.map((s,n)=>{const record={...d,id:n?uid():d.id,photos:[...d.photos]};apply(record,s);return record});drafts.splice(index,1,...records);again()});
 }finally{btn.disabled=false;btn.textContent='Suggest attributes with AI'}});
 on('#edit-form','submit',async e=>{e.preventDefault();read();d.name=d.name.trim();if(!d.name)throw Error('Give this piece a name.');if(index<drafts.length-1){free();editItems(drafts,originals,editing,index+1,base);return}
  const dbItems=await all('items');const seen=new Map(dbItems.filter(i=>!drafts.some(d=>d.id===i.id)).map(i=>[i.photos[0]+'|'+i.name.toLowerCase(),i.id]));
  for(const draft of drafts){const key=draft.photos[0]+'|'+draft.name.toLowerCase();if(seen.has(key))throw Error('A piece with this name and original photo already exists.');seen.set(key,draft.id)}
  const changes=[...originals.map(({id,blob})=>({store:'assets',record:{id,blob}})),...drafts.map(record=>({store:'items',record}))];
  await batch(changes);guard=null;await collectAssets();await refresh();free();closet();render();notify(editing?(drafts.length>1?'Saved '+drafts.length+' pieces.':'Closet updated.'):'Added to your closet.');
 });
}
function profile(){
 const slots=[...refSlots,...refs.filter(r=>!refSlots.some(([id])=>r.id===id)).map(r=>[r.id,r.label||'Additional reference'])];
 sheet('Appearance references','<div class="vstack"><p class="sheet-copy">A full-body front photo and a front-facing headshot anchor the outfit rendering. Other angles are optional. Photos are saved privately to your account and sent to OpenAI only when you render a look.</p><div>'+slots.map(([id,label,required])=>{const r=refs.find(x=>x.id===id);return '<div class="ref-row">'+(r?'<img alt="'+esc(label)+'" src="'+esc(source(r.photo))+'">':'<span class="ref-sample" aria-hidden="true">+</span>')+'<div><strong>'+esc(label)+'</strong><small>'+(required?'Required':'Optional')+'</small></div><div class="actions"><button data-pick="'+id+'">'+(r?'Replace':'Upload')+'</button>'+(r?'<button data-delref="'+id+'" aria-label="Delete '+esc(label)+'">×</button>':'')+'</div></div>'}).join('')+'</div><button id="extra">Add other references</button><button id="sign-out" class="text-btn">Sign out</button><input hidden id="ref-picker" type="file" accept="'+accepts+'"><p class="error" id="inline-error" role="alert"></p></div>');
 const picker=$('#ref-picker');let selected;function pick(id){selected=id;picker.multiple=!id;picker.value='';picker.click()}
 document.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>pick(b.dataset.pick));on('#extra','click',()=>pick(''));
 on('#ref-picker','change',async e=>{const changes=[],files=[...e.target.files];for(const [n,f] of files.entries()){notify('Preparing photo '+(n+1)+' of '+files.length+'…');const record=await photoRecord(f);changes.push({store:'assets',record},{store:'refs',record:{id:selected||uid(),photo:record.id,label:f.name}})}if(!changes.length)return;await batch(changes);await collectAssets();await refresh();profile();render()});
 on('#sign-out','click',async()=>{await signOut();location.reload()});
 document.querySelectorAll('[data-delref]').forEach(b=>b.onclick=wrap(async()=>{await remove('refs',b.dataset.delref);await collectAssets();await refresh();profile();render()}));
}
async function navigate(){
 const seq=++navSeq;const page=location.hash==='#mirror'?'mirror':'studio';if(cleanupMirror){cleanupMirror();cleanupMirror=null}close();$('#studio').hidden=page!=='studio';$('#mirror').hidden=page!=='mirror';
 for(const name of ['studio','mirror']){const link=$('#nav-'+name);if(name===page)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')}
 if(page==='studio'){render();return}
 try{const {mountMirror}=await import('./mirror.js');if(seq!==navSeq)return;cleanupMirror=mountMirror($('#mirror'),{request:api,getContext:async()=>{await refresh();return context()},onSassChange:value=>setting('sass',Number(value))})}catch(e){$('#mirror').textContent='Mirror could not open. '+e.message}
}
on('#open-profile','click',()=>{if(ready)profile()});
function signIn(){
 $('#studio').hidden=false;$('#mirror').hidden=true;
 const body=keyProblem?'<p class="fail" role="alert">'+esc(keyProblem)+'</p>':!configured?'<p class="sheet-copy">Add your Supabase project URL and publishable key to config.js, then reload.</p>':'<p class="sheet-copy">Sign in to open your closet. Your photos and looks are stored privately in your account.</p><form id="signin-form" class="vstack"><label class="field">Email<input type="email" name="email" required autocomplete="email" inputmode="email"></label><button class="primary">Email me a sign-in link</button><p id="inline-error" class="error" role="alert"></p></form>';
 $('#studio').innerHTML='<section class="signin"><div class="studio-head"><h1>The <em>Studio</em></h1></div>'+body+'</section>';
 on('#signin-form','submit',async e=>{e.preventDefault();const form=e.target,btn=form.querySelector('button'),email=String(new FormData(form).get('email')).trim();btn.disabled=true;try{await sendLink(email);form.outerHTML='<p class="sheet-copy" role="status">Sign-in link sent to '+esc(email)+'. Open it on this device to continue.</p>'}finally{btn.disabled=false}});
}
try{
 if(!await currentSession()){signIn()}else{
  await openStore();await Promise.all([refresh(),status()]);active=looks.some(l=>l.id===settings.activeLook)?settings.activeLook:(looks[0]?.id||'');ready=true;await navigate();window.addEventListener('hashchange',()=>navigate());
  client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')location.reload()});
 }
}catch(e){$('#studio').textContent=e.message||'Your closet could not be opened. Reload to try again.'}
