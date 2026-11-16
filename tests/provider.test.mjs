import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {get} from 'node:http';
import {makeServer} from '../server.mjs';
import {perform,validateLook,recentClothing,pickHair,hairFamilies,freshStart} from '../supabase/functions/_shared/provider.mjs';

const items=[{id:'dress',category:'Dresses / One-pieces',name:'Satin slip',status:'available'},{id:'shoes',category:'Shoes',name:'Black boots',status:'available'}];
const look={title:'Hard gloss',itemIds:['dress','shoes'],styling:'Layer the slip over the boots.',makeup:'No product.',makeupPlan:[],reasoning:'Contrasting textures.'};
// The stylist sees short IDs; this maps a look's real IDs to the ones in the request it received.
const aliasesIn=payload=>{const ctx=JSON.parse(payload.input[0].content[0].text);return {ctx,byName:Object.fromEntries(ctx.items.map(i=>[i.name,i.id]))}};
const photo='data:image/jpeg;base64,/9j/2Q==';
const env={OPENAI_API_KEY:'test-only',ENABLE_PAID_API:'true'};
function modelResult(value) {
  return Response.json({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
}
function adapter(callback) {return {env,fetchImpl:callback,reserve(){}};}
test('selection requires a wearable outfit, distinct IDs, current availability and confirmed pieces',()=>{
  assert.equal(validateLook(look,items)[1].id,'shoes');
  for (const idList of [['dress'],['shoes','dress','dress'],['dress','unknown']])
    assert.throws(()=>validateLook({...look,itemIds:idList},items));
  assert.throws(()=>validateLook(look,[items[0],{...items[1],status:'laundry'}]));
  assert.throws(()=>validateLook(look,[items[0],{...items[1],category:'Full Looks / Outfit References'}]));
});
test('selection sends only item metadata and feedback, with short IDs mapped back to real ones',async()=>{
  let payload;
  const request={items:items.map(x=>({...x,image:photo})),history:[{rating:4,itemIds:['dress']}],creativity:9};
  const out=await perform('select',request,adapter(async(url,init)=>{
    assert.ok(url.endsWith('/responses'));
    payload=JSON.parse(init.body);const {byName}=aliasesIn(payload);
    return modelResult({...look,itemIds:[byName['Satin slip'],byName['Black boots']]});
  }));
  assert.deepEqual(out.itemIds,['dress','shoes']);
  assert.equal(payload.store,false);
  assert.equal(payload.text.format.strict,true);
  const {ctx}=aliasesIn(payload);
  assert.ok(ctx.items.every(i=>/^p\d+$/.test(i.id)),'the model only sees short IDs');
  assert.equal(ctx.feedbackAndHistory[0].rating,4);
  assert.match(ctx.feedbackAndHistory[0].pieces[0],/^p\d+$/);
  assert.ok(!JSON.stringify(payload).includes('base64'));
  assert.ok(!JSON.stringify(payload).includes('"dress"'),'real IDs never reach the model');
});
test('an invented or unavailable ID gets one repair attempt instead of an error',async()=>{
  let calls=0,second;
  const out=await perform('select',{items},adapter(async(url,init)=>{
    calls++;const body=JSON.parse(init.body);const {byName}=aliasesIn(body);
    if(calls===1)return modelResult({...look,itemIds:['p99',byName['Satin slip']]});
    second=body;return modelResult({...look,itemIds:[byName['Satin slip'],byName['Black boots']]});
  }));
  assert.equal(calls,2);assert.deepEqual(out.itemIds,['dress','shoes']);
  assert.match(second.input[0].content[1].text,/p99/);
  let n=0;
  const extra=await perform('select',{items},adapter(async(url,init)=>{n++;const {byName}=aliasesIn(JSON.parse(init.body));return modelResult({...look,itemIds:[byName['Satin slip'],'x7',byName['Black boots']]})}));
  assert.equal(n,1,'a stray ID is dropped when the rest is a complete look');assert.deepEqual(extra.itemIds,['dress','shoes']);
  await assert.rejects(perform('select',{items},adapter(async()=>modelResult({...look,itemIds:['invented']}))),/missing or unavailable|complete outfit/);
});
test('makeup is part of every look when there is makeup: a shade plan with hex, matched to skin tone',async()=>{
  const closet=[...items,{id:'pal',category:'Makeup',name:'Gold palette',status:'available',shades:[{name:'Honey',hex:'#C8913A',finish:'shimmer',type:'eyeshadow',use:'lid'}]}];
  let payload;
  const out=await perform('select',{items:closet,skin:{depth:'light-medium',undertone:'warm',hex:'#C99A7E',notes:'Warm golds suit.'}},adapter(async(url,init)=>{
    payload=JSON.parse(init.body);const {byName}=aliasesIn(payload);
    return modelResult({...look,itemIds:[byName['Satin slip'],byName['Black boots']],makeupPlan:[{itemId:byName['Gold palette'],shade:'Honey',hex:'#C8913A',area:'lids',application:'Pack on with a finger.'}]});
  }));
  const {ctx}=aliasesIn(payload);
  assert.match(payload.instructions,/Makeup is part of every look/);
  assert.equal(ctx.appearance.hex,'#C99A7E');
  assert.equal(ctx.items.find(i=>i.name==='Gold palette').shades[0].hex,'#C8913A');
  assert.deepEqual(out.itemIds,['dress','shoes','pal'],'a makeup item used in the plan joins the look');
  assert.equal(out.makeupPlan[0].itemId,'pal');
});
test('rendering requires validated complete current items and appearance before a billable call',async()=>{
  const request={items:items.map(x=>({...x,image:photo})),look,appearance:[photo]};
  let requests=0;
  const options=adapter(async(url,init)=>{
    requests++;
    assert.ok(url.endsWith('/images/edits'));
    assert.equal(init.body.getAll('image[]').length,3);
    assert.equal(init.body.get('size'),'1024x1536');
    return Response.json({data:[{b64_json:'example'}]});
  });
  await assert.rejects(perform('image',{...request,appearance:[]},options),/appearance/);
  await assert.rejects(perform('image',{...request,items:items},options),/reference/);
  assert.equal(requests,0);
  const result=await perform('image',request,options);
  assert.deepEqual(result.itemIds,['dress','shoes']);
  assert.match(result.prompt,/Image 2/);
  assert.equal(result.model,'gpt-image-2.5-sunburst');
});
test('tagging accepts visual inputs and asks for separate editable candidates',async()=>{
  const result=await perform('tag',{image:photo},adapter(async(url,init)=>{
    const payload=JSON.parse(init.body);
    assert.equal(payload.input[0].content[0].type,'input_image');
    assert.equal(payload.input[0].content[0].image_url,photo);
    assert.ok(payload.text.format.schema.properties.suggestions);
    return modelResult({suggestions:[]});
  }));
  assert.deepEqual(result,{suggestions:[]});
});
test('voice exchange issues a short-lived credential and excludes the permanent key',async()=>{
  const result=await perform('realtime',{context:'wearing boots',sass:4},adapter(async(url,init)=>{
    const payload=JSON.parse(init.body);
    assert.ok(url.endsWith('/realtime/client_secrets'));
    assert.equal(payload.session.type,'realtime');
    assert.ok(payload.session.instructions.includes('wearing boots'));
    assert.ok(payload.session.audio.input.turn_detection.interrupt_response);
    assert.equal(payload.expires_after.seconds,30);
    return Response.json({value:'ek_example'});
  }));
  assert.equal(result.value,'ek_example');
  assert.ok(!JSON.stringify(result).includes(env.OPENAI_API_KEY));
});
test('local preview serves only the static site to loopback hosts',async t=>{
  const server=makeServer();
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise(done=>server.close(done)));
  const origin='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(origin+'/')).status,200);
  assert.equal((await fetch(origin+'/api/status')).status,404);
  assert.equal((await fetch(origin+'/.env')).status,404);
  assert.equal((await fetch(origin+'/../.env')).status,404);
  const foreignHost=await new Promise((done,fail)=>get(origin+'/',{headers:{Host:'external.example'}},r=>{r.resume();done(r.statusCode);}).on('error',fail));
  assert.equal(foreignHost,403);
});
test('paid calls reserve a daily slot first and stop when the limit is reached',async()=>{
  let reserved=0;
  const blocked=perform('tag',{image:photo},{env,fetchImpl:()=>assert.fail('Unexpected paid call'),reserve:async()=>{reserved++;throw Object.assign(new Error('Daily tag request limit reached.'),{status:429});}});
  await assert.rejects(blocked,/limit reached/);
  assert.equal(reserved,1);
});
test('provider API errors are actionable without exposing provider payloads or credentials',async()=>{
  await assert.rejects(perform('tag',{image:photo},adapter(async()=>Response.json({error:'internal-data'},{status:401}))),err=>err.status===502&&!err.message.includes('internal-data')&&err.message.includes('OPENAI_API_KEY'));
});

test('read-aloud makes one counted speech call, times the words, and survives a failed timing call',async()=>{
  const calls=[];let reserved=0;
  const mp3=new Uint8Array([73,68,51,4,0,0]);
  const fetchImpl=async(url,init)=>{
    calls.push(url);
    if(url.endsWith('/audio/speech')){const p=JSON.parse(init.body);assert.equal(p.voice,'marin');assert.equal(p.model,'gpt-4o-mini-tts');assert.equal(p.input,'Tuck the knit.');assert.ok(p.instructions);return new Response(mp3,{status:200});}
    if(url.endsWith('/audio/transcriptions')){assert.equal(init.body.get('model'),'whisper-1');assert.equal(init.body.get('timestamp_granularities[]'),'word');return Response.json({words:[{word:'Tuck',start:0,end:.3},{word:'the',start:.3,end:.4},{word:'knit',start:.4,end:.8}]});}
    assert.fail('unexpected '+url);
  };
  const result=await perform('speak',{text:'Tuck the knit.'},{env,fetchImpl,reserve:()=>{reserved++;}});
  assert.equal(reserved,1,'one daily-limit slot per read-aloud');
  assert.match(result.audio,/^data:audio\/mpeg;base64,/);
  assert.deepEqual(result.words,[{w:'Tuck',s:0,e:.3},{w:'the',s:.3,e:.4},{w:'knit',s:.4,e:.8}]);
  assert.ok(!JSON.stringify(result).includes(env.OPENAI_API_KEY));
  const fallback=await perform('speak',{text:'Tuck the knit.'},{env,fetchImpl:async url=>url.endsWith('/audio/speech')?new Response(mp3):new Response('down',{status:500}),reserve(){}});
  assert.equal(fallback.words,null,'timing failure still returns the audio');
  await assert.rejects(perform('speak',{text:''},{env,fetchImpl,reserve(){}}),/read aloud/);
  await assert.rejects(perform('speak',{text:'x'},{env,fetchImpl:async()=>new Response('',{status:429}),reserve(){}}),/429/);
});

test('variety: recent clothing may return once when it pushes the style; a near-repeat is sent back; shoes may repeat',async()=>{
  const closet=[...Array.from({length:6},(_,i)=>({id:'top'+i,category:'Tops',name:'top '+i,status:'available'})),...Array.from({length:6},(_,i)=>({id:'bot'+i,category:'Bottoms',name:'bottom '+i,status:'available'})),
    {id:'docs',category:'Shoes',name:'docs',status:'available'},{id:'vans',category:'Shoes',name:'vans',status:'available'},{id:'tote',category:'Bags',name:'tote',status:'available'}];
  const history=[{itemIds:['top1','bot1','docs','tote']},{itemIds:['top2','bot2','docs']},{itemIds:['top3','bot1']},{itemIds:['top4']}];
  assert.deepEqual([...recentClothing(closet,history)].sort(),['bot1','bot2','top1','top2','top3'],'clothing from the last three looks only; not shoes or bags');
  const pick=(ctx,names)=>{const idOf=Object.fromEntries(ctx.items.map(i=>[i.name,i.id]));return names.map(n=>idOf[n])};
  // Every piece is still offered, recent clothing is marked, and one reused piece plus repeated shoes is fine.
  let calls=0,ctx,sent;
  const one=await perform('select',{items:closet,history},adapter(async(url,init)=>{calls++;sent=JSON.parse(init.body);ctx=JSON.parse(sent.input[0].content[0].text);return modelResult({...look,itemIds:pick(ctx,['top 1','bottom 0','docs','tote'])})}));
  assert.equal(calls,1);assert.equal(ctx.items.length,15,'nothing is hidden from the stylist');
  assert.deepEqual(ctx.items.filter(i=>i.wornInRecentLooks).map(i=>i.name).sort(),['bottom 1','bottom 2','top 1','top 2','top 3']);
  assert.deepEqual(one.itemIds,['top1','bot0','docs','tote']);
  assert.match(sent.instructions,/at most one such piece/);assert.match(sent.instructions,/Shoes, bags, jewelry and makeup may repeat, but rotate them/);
  // Two reused clothing pieces is too close to a recent look: one repair.
  calls=0;let second;
  const two=await perform('select',{items:closet,history},adapter(async(url,init)=>{calls++;const body=JSON.parse(init.body);const c=JSON.parse(body.input[0].content[0].text);if(calls===2)second=body;
    return modelResult({...look,itemIds:pick(c,calls===1?['top 1','bottom 1','docs']:['top 0','bottom 1','docs'])})}));
  assert.equal(calls,2);assert.deepEqual(two.itemIds,['top0','bot1','docs']);assert.match(second.input[0].content[1].text,/too close to a recent look/);
  // If the second try is unusable, the first valid look is kept: variety never blocks a look.
  calls=0;
  const kept=await perform('select',{items:closet,history},adapter(async(url,init)=>{calls++;const c=JSON.parse(JSON.parse(init.body).input[0].content[0].text);
    return modelResult({...look,itemIds:calls===1?pick(c,['top 1','bottom 1','docs']):['nope']})}));
  assert.deepEqual(kept.itemIds,['top1','bot1','docs']);
  // The order still changes between requests.
  const orders=new Set();
  for(let n=0;n<4;n++)await perform('select',{items:closet},adapter(async(url,init)=>{const c=JSON.parse(JSON.parse(init.body).input[0].content[0].text);orders.add(c.items.map(i=>i.name).join());return modelResult({...look,itemIds:pick(c,['top 0','bottom 0','vans'])})}));
  assert.ok(orders.size>1);
});
test('every look plans a hairstyle that fits the owner\'s hair, with hair ties only, and the render follows it',async()=>{
  let sent;
  const skin={depth:'light-medium',undertone:'warm',hex:'#C99A7E',notes:'',hairLength:'mid-back, long layers',hairColor:'dark brown',hairTexture:'wavy, thick'};
  await perform('select',{items,skin},adapter(async(url,init)=>{sent=JSON.parse(init.body);const c=JSON.parse(sent.input[0].content[0].text);const idOf=Object.fromEntries(c.items.map(i=>[i.name,i.id]));return modelResult({...look,itemIds:[idOf['Satin slip'],idOf['Black boots']],hair:{style:'Bubble ponytail',steps:'Tie a high ponytail, add ties every few inches.'}})}));
  const c=JSON.parse(sent.input[0].content[0].text);
  assert.equal(c.appearance.hairLength,'mid-back, long layers');assert.equal(c.appearance.hairColor,'dark brown');
  assert.match(sent.instructions,/only hair ties/);assert.match(sent.instructions,/never change the color or length/);
  assert.deepEqual(sent.text.format.schema.properties.hair.required,['style','steps']);
  let form;
  await perform('image',{items:items.map(x=>({...x,image:photo})),look:{...look,hair:{style:'Bubble ponytail',steps:'Tie it high.'}},appearance:[photo],skin},adapter(async(url,init)=>{form=init.body;return Response.json({data:[{b64_json:'AAAA'}]})}));
  assert.match(form.get('prompt'),/Bubble ponytail/);assert.match(form.get('prompt'),/mid-back, long layers, dark brown/);
});
test('tagging can name the piece a photo is for, as data rather than instructions',async()=>{
  let sent;
  await perform('tag',{image:'data:image/png;base64,iVBORw0KGgo=',label:'doc martins'},adapter(async(url,init)=>{sent=JSON.parse(init.body);return modelResult({suggestions:[]})}));
  assert.equal(sent.input[0].content[0].text,'The owner calls this piece: "doc martins"');
  assert.equal(sent.input[0].content[1].type,'input_image');
  assert.match(sent.instructions,/untrusted data/);
  await perform('tag',{image:'data:image/png;base64,iVBORw0KGgo='},adapter(async(url,init)=>{sent=JSON.parse(init.body);return modelResult({suggestions:[]})}));
  assert.equal(sent.input[0].content.length,1,'no label, image only');
});

test('rendering describes makeup by shade instead of sending palette photos, keeps skin tone, and allows pieces in the wash',async()=>{
  const closet=[{...items[0],status:'laundry',image:photo,aiDescription:'Bias-cut ivory satin slip, falls to mid-calf.'},{...items[1],image:photo},{id:'pal',category:'Makeup',name:'Gold palette',status:'available',image:photo}];
  const plan=[{itemId:'pal',shade:'Honey',hex:'#C8913A',area:'lids',application:'Pack on.'}];
  let form;
  await perform('image',{items:closet,look:{...look,itemIds:['dress','shoes','pal'],makeupPlan:plan},appearance:[photo],skin:{hex:'#C99A7E'}},adapter(async(url,init)=>{form=init.body;return Response.json({data:[{b64_json:'AAAA'}]})}));
  assert.equal(form.getAll('image[]').length,3,'one appearance photo plus the dress and shoes; no palette photo');
  const prompt=form.get('prompt');
  assert.match(prompt,/#C8913A/);assert.match(prompt,/#C99A7E/);assert.match(prompt,/mid-calf/);
});

test('skin tone and hair come from the owner\'s photos, for makeup and hairstyles only',async()=>{
  let sent;
  const out=await perform('skin',{image:photo,body:photo},adapter(async(url,init)=>{sent=JSON.parse(init.body);return modelResult({depth:'light-medium',undertone:'warm',hex:'#C99A7E',notes:'Warm golds suit.',hairLength:'mid-back',hairColor:'dark brown',hairTexture:'wavy'})}));
  assert.equal(out.hex,'#C99A7E');assert.equal(out.hairLength,'mid-back');
  assert.equal(sent.input[0].content.length,2,'headshot and full-body photo, so hair length is visible');
  assert.equal(sent.text.format.name,'skin_tone');
  assert.match(sent.instructions,/Do not infer ethnicity/);
});

test('hairstyles vary: a direction is picked from families not used in the last four looks, bolder with more creativity',async()=>{
  const seq=v=>()=>v;
  const recent=[{hair:'loose'},{hair:'half-up'},{hair:'top-knot'},{hair:'braid'},{hair:'pigtails'}];
  for (let r=0;r<1;r+=0.05) { const f=pickHair(recent,8,seq(r)); assert.ok(!['loose','half-up','top-knot','braid'].includes(f.key),f.key); }
  assert.ok(Array.from({length:40},(_,i)=>pickHair([],3,seq(i/40))).every(f=>f.bold<=3),'calm creativity keeps it wearable');
  assert.ok(new Set(Array.from({length:40},(_,i)=>pickHair([],10,seq(i/40)).key)).size===hairFamilies.length,'every family is possible at high creativity, including leaving it loose');
  let sent;
  const out=await perform('select',{items,history:recent,creativity:9},adapter(async(url,init)=>{sent=JSON.parse(init.body);const c=JSON.parse(sent.input[0].content[0].text);const idOf=Object.fromEntries(c.items.map(i=>[i.name,i.id]));return modelResult({...look,itemIds:[idOf['Satin slip'],idOf['Black boots']],hair:{style:'Space buns',steps:'Two high buns.'}})}));
  const family=hairFamilies.find(f=>sent.instructions.includes('The hairstyle direction for this look is '+f.text));
  assert.ok(family&&!['loose','half-up','top-knot','braid'].includes(family.key));
  assert.equal(out.hair.family,family.key,'the family is saved with the look so the next one can avoid it');
});

test('fresh starts: an unworn anchor piece, and streaky shoes or jewelry sit one look out',async()=>{
  const closet=[...Array.from({length:4},(_,i)=>({id:'top'+i,category:'Tops',name:'top '+i,status:'available'})),{id:'bot0',category:'Bottoms',name:'bottom 0',status:'available'},{id:'bot1',category:'Bottoms',name:'bottom 1',status:'available'},
    {id:'docs',category:'Shoes',name:'docs',status:'available'},{id:'loafers',category:'Shoes',name:'loafers',status:'available'},{id:'hoops',category:'Jewelry',name:'hoops',status:'available'},{id:'chain',category:'Jewelry',name:'chain',status:'available'}];
  const history=[{itemIds:['top0','bot0','docs','hoops']},{itemIds:['top1','bot0','docs','hoops','chain']},{itemIds:['top2','bot1','loafers','hoops']},{itemIds:['top0','bot1','docs','chain']}];
  const {anchor,offered,resting}=freshStart(closet,history,()=>0);
  assert.equal(anchor.id,'top3','the anchor is clothing not seen in recent looks');
  assert.deepEqual([...resting].sort(),['docs','hoops'],'three of the last four looks');
  assert.ok(!offered.some(i=>['docs','hoops'].includes(i.id))&&offered.some(i=>i.id==='loafers')&&offered.some(i=>i.id==='chain'));
  // The only pair of shoes is never benched.
  assert.ok(freshStart(closet.filter(i=>i.id!=='loafers'),history).offered.some(i=>i.id==='docs'));
  let sent;
  await perform('select',{items:closet,history},adapter(async(url,init)=>{sent=JSON.parse(init.body);const c=JSON.parse(sent.input[0].content[0].text);const idOf=Object.fromEntries(c.items.map(i=>[i.name,i.id]));
    assert.ok(c.anchorPieceId&&c.items.find(i=>i.id===c.anchorPieceId).name==='top 3');
    assert.ok(!('docs' in idOf)&&!('hoops' in idOf),'resting pieces are not offered');
    return modelResult({...look,itemIds:[idOf['top 3'],idOf['bottom 0'],idOf['loafers']]})}));
  assert.match(sent.instructions,/Build this look around the anchor piece/);
});
