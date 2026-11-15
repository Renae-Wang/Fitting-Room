import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {get} from 'node:http';
import {makeServer} from '../server.mjs';
import {perform,validateLook,freshPieces} from '../supabase/functions/_shared/provider.mjs';

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
  assert.equal(ctx.skinTone.hex,'#C99A7E');
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

test('variety is enforced: recent clothing and the last shoes and bag are left out, unless that leaves no complete outfit',async()=>{
  const closet=[...Array.from({length:6},(_,i)=>({id:'top'+i,category:'Tops',name:'top '+i,status:'available'})),...Array.from({length:6},(_,i)=>({id:'bot'+i,category:'Bottoms',name:'bottom '+i,status:'available'})),
    {id:'docs',category:'Shoes',name:'docs',status:'available'},{id:'vans',category:'Shoes',name:'vans',status:'available'},{id:'tote',category:'Bags',name:'tote',status:'available'},{id:'hoops',category:'Jewelry',name:'hoops',status:'available'}];
  const history=[{itemIds:['top1','bot1','docs','tote','hoops']},{itemIds:['top2','bot2','docs']},{itemIds:['top3','bot1']},{itemIds:['top4']}];
  const offered=freshPieces(closet,history).map(i=>i.id);
  for (const id of ['top1','top2','top3','bot1','bot2','docs','tote']) assert.ok(!offered.includes(id),id+' is left out');
  for (const id of ['top4','top0','bot0','vans','hoops']) assert.ok(offered.includes(id),id+' is still offered');
  // Only one pair of shoes: they come back rather than making an outfit impossible.
  assert.ok(freshPieces(closet.filter(i=>i.id!=='vans'),history).some(i=>i.id==='docs'));
  // Every top worn recently: fall back to the whole closet.
  assert.equal(freshPieces(closet.filter(i=>['top1','bot0','vans'].includes(i.id)),history).length,3);
  const orders=new Set();let sent;
  for(let n=0;n<4;n++){
    await perform('select',{items:closet,occasion:'Everyday',history},adapter(async(url,init)=>{
      sent=JSON.parse(init.body);const ctx=JSON.parse(sent.input[0].content[0].text);
      const idOf=Object.fromEntries(ctx.items.map(i=>[i.name,i.id]));orders.add(ctx.items.map(i=>i.name).join());
      assert.ok(!ctx.items.some(i=>['top 1','bottom 1','docs'].includes(i.name)),'the stylist never sees recent pieces');
      return modelResult({...look,itemIds:[idOf['top 0'],idOf['bottom 0'],idOf['vans']]});
    }));
  }
  assert.ok(orders.size>1,'the order changes between requests');
  assert.match(sent.instructions,/Favor variety/);
  // A recent piece slipped in by the model is rejected, then repaired.
  let calls=0;
  const out=await perform('select',{items:closet,history},adapter(async(url,init)=>{calls++;const ctx=JSON.parse(JSON.parse(init.body).input[0].content[0].text);const idOf=Object.fromEntries(ctx.items.map(i=>[i.name,i.id]));
    return modelResult({...look,itemIds:calls===1?['top1',idOf['bottom 0'],idOf['vans']]:[idOf['top 0'],idOf['bottom 0'],idOf['vans']]})}));
  assert.equal(calls,2);assert.deepEqual(out.itemIds,['top0','bot0','vans']);
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

test('skin tone comes from the headshot, for makeup matching only',async()=>{
  let sent;
  const out=await perform('skin',{image:photo},adapter(async(url,init)=>{sent=JSON.parse(init.body);return modelResult({depth:'light-medium',undertone:'warm',hex:'#C99A7E',notes:'Warm golds suit.'})}));
  assert.equal(out.hex,'#C99A7E');
  assert.equal(sent.text.format.name,'skin_tone');
  assert.match(sent.instructions,/Do not infer ethnicity/);
});
