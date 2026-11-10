import {openStore,all,batch,put,remove,photoRecord,referenceJPEG,collectAssets,assetBlob} from './store.js';
import {client,configured,keyProblem,currentSession,sendLink,signOut,api} from './supabase.js';

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
function sheet(title,markup){dialogSeq++;$('#sheet-title').textContent=title;$('#sheet-body').innerHTML=markup;const d=$('#sheet');if(!d.open)d.showModal();d.scrollTop=0}
function close(){if($('#sheet').open)$('#sheet').close()}
$('#close-sheet').onclick=close;
$('#sheet').addEventListener('close',()=>{dialogSeq++;if(ready&&location.hash!=='#mirror')render()});
function wrap(fn){return async e=>{try{await fn(e)}catch(err){notify(err.message||'Something went wrong. Retry the action.');const live=$('#inline-error');if(live)live.textContent=err.message}}}
function on(sel,event,fn){const el=$(sel);if(el)el.addEventListener(event,wrap(fn))}
const setupLine=(ok,action,text)=>'<li class="'+(ok?'ok':'')+'"><button type="button" data-setup="'+action+'">'+esc(text)+'</button></li>';
function setupMarkup(){const c=coverage(),count=[c.base,c.shoes,c.body&&c.face,state.enabled].filter(Boolean).length;if(count===4)return '';return '<section class="setup"><div class="setup-head">Set up your studio <span class="micro">'+count+' / 4</span></div><ul class="setup-list">'+setupLine(c.base,'closet',c.base?'Outfit foundation ready':'Add a top and bottom, or a one-piece')+setupLine(c.shoes,'closet',c.shoes?'Shoes ready':'Add a pair of shoes')+setupLine(c.body&&c.face,'profile',c.body&&c.face?'Appearance references ready':'Add a full-body front photo and headshot')+setupLine(state.enabled,'api',state.enabled?'AI services connected':'Connect AI services')+'</ul></section>'}
function flowMarkup(l){
 const states=busy==='Selecting pieces…'?['current','','']:busy?['done','current','']:l?.image?['done','done','done']:l?.renderFailed?['done','failed','']:l?['done','','']:null;if(!states)return '';
 return '<ol class="flow" aria-label="Outfit progress">'+['Selecting pieces','Rendering look','Look ready'].map((title,i)=>{const state=states[i];return '<li'+(state?' class="'+state+'"':'')+(state==='current'?' aria-current="step"':'')+'><span aria-hidden="true">'+(state==='failed'?'!':i+1)+'</span>'+(state==='failed'?'Image didn’t render':title)+'</li>'}).join('')+'</ol>'}
function details(l){return '<section class="look-card"><span class="micro">Look notes</span><h2>'+esc(l.title)+'</h2><p>'+esc(l.reasoning)+'</p><div class="item-strip">'+l.itemIds.map(id=>{const it=items.find(i=>i.id===id);return it?'<div class="item-chip"><img src="'+esc(source(it.photos[0]))+'" alt=""><span>'+esc(it.name)+'</span></div>':'<span class="hint">Deleted closet item</span>'}).join('')+'</div><details class="settings"><summary>Styling &amp; makeup instructions</summary><div><p>'+esc(l.styling)+'</p><p>'+esc(l.makeup)+'</p></div></details><div class="actions"><button id="save-look" '+(l.saved?'disabled':'')+'>'+ (l.saved?'Saved to lookbook':'Save look')+'</button><button id="render-look" '+(busy||!state.enabled?'disabled':'')+'>'+(l.image?'Regenerate image':l.renderFailed?'Retry image':'Generate image')+'</button><button id="rate-look">Rate after wearing</button></div></section>'}
function render(){
 if(!ready)return;
 const s=pref(),l=current(),c=coverage(),canGenerate=state.enabled&&c.base&&c.shoes&&c.body&&c.face;
 const date=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(Date.now());
 $('#studio').innerHTML='<div class="studio-head"><h1>The <em>Studio</em></h1><div class="studio-actions"><button id="closet">'+icon('closet')+'Closet</button><button id="looks">'+icon('history')+'Lookbook</button></div></div><div class="editor"><div><figure class="plate"><div class="plate-frame '+(l?.image?'':'empty')+'"><span class="tag"><i class="dot"></i>'+(l?.image?'AI preview':'Dress form')+'</span><img src="'+(l?.image?esc(l.image):'form.svg')+'" alt="'+(l?.image?'AI visualization of '+esc(l.title):'Illustrated linen dress form on a neutral background')+'"></div><figcaption><span>'+(l?.image?'Compare the rendering with your original items below.':l?.renderFailed?'Your outfit is saved with the same pieces. Retrying only redraws the image.':l?'Outfit selected. Visualization pending.':'Your outfit preview will appear here.')+'</span><span class="micro">'+esc(date)+'</span></figcaption></figure>'+flowMarkup(l)+(l?details(l):'')+'</div><section class="brief"><div class="brief-top"><h2>Styling brief</h2>'+icon('spark')+'</div><label class="field">Dressing for<select id="occasion">'+options(occasions,s.occasion)+'</select></label><label class="field"><span>Today’s context <small> · optional</small></span><textarea id="day-context" maxlength="1400" placeholder="Weather, dress code, plans, comfort…">'+esc(s.context)+'</textarea></label><details class="settings"><summary>Styling preferences</summary><div>'+slider('creativity','Experimentation',s.creativity,1,10)+slider('sass','Sass',s.sass,0,4)+'<label class="field">Personal style<input id="style" value="'+esc(s.style)+'" maxlength="700" placeholder="What should the stylist remember?"></label></div></details><button class="primary" id="generate" '+(!canGenerate||busy?'disabled':'')+'>'+(busy?'<span class="loading"></span>'+esc(busy):(l?'Generate new outfit':'Generate outfit')+icon('arrow'))+'</button>'+(canGenerate?'<p class="action-note">Uses one styling request and one image request. '+esc(state.remaining?.image??'—')+' image requests left today.</p>':'')+(failure?'<p role="alert" class="fail">'+esc(failure)+'</p>':'')+setupMarkup()+'</section></div>';
 on('#closet','click',closet);on('#looks','click',lookbook);on('#occasion','change',e=>setting('occasion',e.target.value));on('#day-context','input',e=>setting('context',e.target.value));on('#style','input',e=>setting('style',e.target.value));
 for(const id of ['creativity','sass'])wireSlider(id);
 on('#generate','click',()=>runLook(false));on('#render-look','click',()=>runLook(true));
 on('#save-look','click',async()=>{const l=current();await put('looks',{...l,saved:true});await refresh();render();notify('Saved to your lookbook.')});on('#rate-look','click',rate);
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
 await put('looks',{...latest,image:response.image,renderFailed:false,imagePrompt:response.prompt,imageModel:response.model});
}
async function runLook(imageOnly){
 if(busy)return;failure='';busy=imageOnly?'Visualizing outfit…':'Selecting pieces…';render();
 try{
  await refresh();let l=current();if(!imageOnly){
   const p=pref();if(p.occasion==='Custom Occasion'&&!p.context.trim())throw Error('Describe your custom occasion in today’s context.');const result=await request('select',{items:available().map(publicItem),occasion:p.occasion,context:p.context,preferences:p.style,history:historyFields(),sass:p.sass,creativity:p.creativity});
   await refresh();const usable=new Set(available().map(i=>i.id));if(!Array.isArray(result.itemIds)||!result.itemIds.length||new Set(result.itemIds).size!==result.itemIds.length||result.itemIds.some(i=>!usable.has(i)))throw Error('The selected pieces could not be matched to your current closet. Try again.');
   l={...result,id:uid(),created:Date.now(),occasion:p.occasion,saved:false,rating:null,feedback:''};
   await batch([{store:'looks',record:l},{store:'settings',record:{id:'activeLook',value:l.id}}]);active=l.id;await refresh();busy='Visualizing outfit…';render();
  }if(!l)throw Error('Generate an outfit first.');try { await visualize(l); } catch (err) {
   const saved=(await all('looks')).find(row=>row.id===l.id);
   if(saved && !saved.image)await put('looks',{...saved,renderFailed:true});
   throw err;
  }
 }catch(e){failure=e.message}finally{busy='';await refresh();await status();render()}
}
function lookbook(){
 const rows=looks.map(l=>'<div class="history-row">'+(l.image?'<img alt="" src="'+esc(l.image)+'">':'<span class="history-blank"></span>')+'<div class="history-title"><strong>'+esc(l.title)+'</strong><small>'+esc(l.occasion)+' · '+(l.saved?'Saved':'Generated')+(l.rating?' · '+l.rating+'/5':'')+'</small></div><button data-view="'+l.id+'">View</button><button data-drop="'+l.id+'" aria-label="Remove '+esc(l.title)+'">×</button></div>').join('');
 sheet('Lookbook','<div class="vstack">'+(rows||'<div class="empty-note">Your generated looks and wear ratings will appear here.</div>')+'</div>');
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=wrap(async()=>{active=b.dataset.view;await setting('activeLook',active);close();render()}));
 document.querySelectorAll('[data-drop]').forEach(b=>b.onclick=wrap(async()=>{const id=b.dataset.drop;if(!confirm('Delete this look, its preview, and its rating?'))return;await remove('looks',id);await refresh();if(active===id){active=looks[0]?.id||'';await setting('activeLook',active)}lookbook();render()}));
}
function rate(){const l=current();sheet('After wearing','<form id="feedback" class="vstack"><label class="field">Rating<select name="rating" required><option value="">Choose a rating</option>'+[1,2,3,4,5].map(v=>'<option value="'+v+'" '+(v===l.rating?'selected':'')+'>'+v+' / 5</option>').join('')+'</select></label><label class="field">What worked or missed?<textarea name="feedback" maxlength="1000">'+esc(l.feedback)+'</textarea></label><button class="primary">Save feedback</button></form>');on('#feedback','submit',async e=>{e.preventDefault();const f=new FormData(e.target);const latest=(await all('looks')).find(x=>x.id===l.id);if(!latest)throw Error('This look has been removed.');await put('looks',{...latest,rating:Number(f.get('rating')),feedback:f.get('feedback')});await refresh();close();notify('Feedback saved for future styling requests.')})}
function closet(){
 sheet('Closet','<div class="vstack"><div class="row"><label class="field">Search<input type="search" id="item-search" placeholder="Search your closet"></label><label class="field">Category<select id="cat-filter">'+options(['All categories',...categories],'All categories')+'</select></label></div><div class="actions"><button id="add-item" class="primary">'+icon('plus')+'Add pieces</button><span id="item-count" class="hint"></span></div><div id="catalog" class="list-grid"></div></div>');
 const draw=()=>{const query=$('#item-search').value.toLowerCase().trim(),cat=$('#cat-filter').value;const filtered=items.filter(i=>(cat==='All categories'||cat===i.category)&&[i.name,i.category,i.color,i.status,i.material,i.pattern].some(v=>String(v||'').toLowerCase().includes(query)));$('#item-count').textContent=filtered.length+' '+(filtered.length===1?'piece':'pieces');$('#catalog').innerHTML=filtered.length?filtered.map(i=>'<button class="tile" data-item="'+i.id+'"><img alt="" src="'+esc(source(i.photos[0]))+'"><strong>'+esc(i.name)+'</strong><small>'+esc(i.category)+(i.status!=='available'?' · '+esc(i.status):'')+'</small></button>').join(''):'<div class="empty-note">'+(items.length?'No matching pieces.':'Add your first piece to start your closet.')+'</div>';document.querySelectorAll('[data-item]').forEach(b=>b.onclick=wrap(()=>editItems([{...items.find(i=>i.id===b.dataset.item)}],[],true)))};
 on('#item-search','input',draw);on('#cat-filter','change',draw);on('#add-item','click',uploadStart);draw();
}
const accepts='image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif';
function dropZone(id,label){return '<label class="drag" id="'+id+'-drop">'+esc(label)+'<input type="file" id="'+id+'" multiple accept="'+accepts+'"></label>'}
function bindDrop(id,fn){const el=$('#'+id+'-drop');on('#'+id,'change',e=>fn([...e.target.files]));el.ondragover=e=>{e.preventDefault();el.classList.add('over')};el.ondragleave=()=>el.classList.remove('over');el.ondrop=wrap(async e=>{e.preventDefault();el.classList.remove('over');await fn([...e.dataTransfer.files])})}
function uploadStart(){
 sheet('Add to closet','<div class="vstack"><label class="field">These photos show<select id="batch-mode"><option value="separate">A different piece in each photo</option><option value="angles">Multiple angles of one piece</option></select></label>'+dropZone('new-files','Drop photos here, or choose files')+'<p id="intake-status" class="hint" role="status" aria-live="polite"></p><p class="hint">Review each piece before adding it to your closet. iPhone HEIC photos work. Photos are saved privately to your account.</p><p id="inline-error" class="error" role="alert"></p></div>');
 bindDrop('new-files',async files=>{if(!files.length)return;const mode=$('#batch-mode').value,seq=dialogSeq;$('#new-files').disabled=true;try{
  const records=[],status=$('#intake-status');for(const [n,file] of files.entries()){if(status)status.textContent='Preparing photo '+(n+1)+' of '+files.length+'…';const r=await photoRecord(file);if(!records.some(x=>x.id===r.id))records.push({...r,name:file.name.replace(/\.[^/.]+$/,'').replace(/[_-]/g,' ')})}if(status)status.textContent='';
  if(seq!==dialogSeq)return;
  const recordGroups=mode==='angles'?[records]:records.map(r=>[r]);const drafts=recordGroups.map(group=>({id:uid(),name:group[0].name,photos:group.map(r=>r.id),category:categories[0],status:'available'}));
  editItems(drafts,records,false);
 }finally{if($('#new-files'))$('#new-files').disabled=false;const st=$('#intake-status');if(st)st.textContent=''}});
}
function editItems(drafts,originals,editing,index=0){
 const d=drafts[index];const local=new Map(originals.map(o=>[o.id,o]));const viewUrls=[];
 const display=id=>{if(assets.has(id))return source(id);const blob=local.get(id)?.blob;if(!blob)return '';const url=URL.createObjectURL(blob);viewUrls.push(url);return url};
 const free=()=>{for(const u of viewUrls)URL.revokeObjectURL(u)};
 sheet(editing?'Edit piece':'Review '+(drafts.length>1?'piece '+(index+1)+' of '+drafts.length:'piece'),'<form id="edit-form" class="vstack"><div class="photo-strip">'+d.photos.map((id,n)=>'<div><img alt="Piece angle '+(n+1)+'" src="'+esc(display(id))+'">'+(d.photos.length>1?'<button type="button" class="text-btn" data-remove-angle="'+id+'">Remove</button>':'')+'</div>').join('')+'</div><label class="field">Add more angles<input type="file" id="more-angles" multiple accept="'+accepts+'"></label><div class="actions"><button type="button" id="tag-photo" '+(!state.enabled?'disabled':'')+'>Suggest attributes with AI</button></div><p class="hint">'+(state.enabled?'Sends the first photo for visual analysis. Review suggestions below.':'Manual entry is available. AI tagging requires a connected provider.')+'</p><div id="tag-results" aria-live="polite"></div><label class="field">Item name<input name="name" maxlength="120" required value="'+esc(d.name)+'"></label><div class="grid2"><label class="field">Category<select name="category">'+options(categories,d.category)+'</select></label><label class="field">Status<select name="status">'+options(['available','laundry','unavailable','archived'],d.status)+'</select></label></div><details class="settings" '+(editing?'open':'')+'><summary>Attributes &amp; makeup details</summary><div class="grid2">'+attrs.map(([k,l])=>'<label class="field">'+l+'<input name="'+k+'" maxlength="500" value="'+esc(d[k])+'"></label>').join('')+'</div></details><p id="inline-error" role="alert" class="error"></p><div class="form-foot"><button class="primary">'+(index<drafts.length-1?'Review next piece':editing?'Save changes':drafts.length>1?'Add '+drafts.length+' pieces':'Add to closet')+'</button><button type="button" id="back-closet">Cancel</button>'+(editing?'<button type="button" id="delete-item" class="danger">Delete item</button>':'')+'</div></form>');
 const seq=dialogSeq;
 $('#sheet').addEventListener('close',free,{once:true});
 const read=()=>Object.assign(d,Object.fromEntries(new FormData($('#edit-form'))));
 const again=()=>{free();editItems(drafts,originals,editing,index)};
 document.querySelectorAll('[data-remove-angle]').forEach(b=>b.onclick=wrap(()=>{read();d.photos=d.photos.filter(p=>p!==b.dataset.removeAngle);again()}));
 on('#more-angles','change',async e=>{const files=[...e.target.files];read();const add=[];for(const [n,f] of files.entries()){notify('Preparing photo '+(n+1)+' of '+files.length+'…');add.push(await photoRecord(f))}if(seq!==dialogSeq)return;for(const r of add)if(!d.photos.includes(r.id)){d.photos=[...d.photos,r.id];originals.push(r)}again()});
 on('#back-closet','click',()=>{free();closet()});
 on('#delete-item','click',async()=>{if(!confirm('Delete this item and its private photographs?'))return;await remove('items',d.id);await collectAssets();await refresh();free();closet();render()});
 on('#tag-photo','click',async e=>{const btn=e.currentTarget;btn.disabled=true;btn.textContent='Analyzing photo…';try{
  const blob=local.get(d.photos[0])?.blob||await assetBlob(d.photos[0]);
  const {suggestions}=await request('tag',{image:await referenceJPEG(blob)});if(seq!==dialogSeq)return;if(!Array.isArray(suggestions)||!suggestions.length)throw Error('No clear item was detected. Enter its attributes manually.');
  const target=$('#tag-results');target.innerHTML='<span class="section-label">Suggested pieces</span><p class="hint">Choose one to fill the current record.'+(suggestions.length>1&&!editing?' You can also review each as a separate piece.':'')+'</p><div class="actions">'+suggestions.map((s,i)=>'<button type="button" data-sug="'+i+'">'+esc(s.name)+'</button>').join('')+(suggestions.length>1&&!editing?'<button type="button" id="split">Review all as separate pieces</button>':'')+'</div>';
  function apply(rec,s){for(const k of ['name','category',...attrs.map(a=>a[0])])if(typeof s[k]==='string'&&(k!=='category'||categories.includes(s[k])))rec[k]=s[k]}
  target.querySelectorAll('[data-sug]').forEach(b=>b.onclick=wrap(()=>{read();apply(d,suggestions[Number(b.dataset.sug)]);again()}));
  on('#split','click',()=>{read();const records=suggestions.map((s,n)=>{const record={...d,id:n?uid():d.id,photos:[...d.photos]};apply(record,s);return record});drafts.splice(index,1,...records);again()});
 }finally{btn.disabled=false;btn.textContent='Suggest attributes with AI'}});
 on('#edit-form','submit',async e=>{e.preventDefault();read();d.name=d.name.trim();if(!d.name)throw Error('Give this piece a name.');if(index<drafts.length-1){free();editItems(drafts,originals,editing,index+1);return}
  const dbItems=await all('items');const seen=new Map(dbItems.filter(i=>!drafts.some(d=>d.id===i.id)).map(i=>[i.photos[0]+'|'+i.name.toLowerCase(),i.id]));
  for(const draft of drafts){const key=draft.photos[0]+'|'+draft.name.toLowerCase();if(seen.has(key))throw Error('A piece with this name and original photo already exists.');seen.set(key,draft.id)}
  const changes=[...originals.map(({id,blob})=>({store:'assets',record:{id,blob}})),...drafts.map(record=>({store:'items',record}))];
  await batch(changes);await collectAssets();await refresh();free();closet();render();notify(editing?'Closet updated.':'Added to your closet.');
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
