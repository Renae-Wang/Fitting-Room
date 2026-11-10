import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {get} from 'node:http';
import {makeServer} from '../server.mjs';
import {perform,validateLook} from '../supabase/functions/_shared/provider.mjs';

const items=[{id:'dress',category:'Dresses / One-pieces',name:'Satin slip',status:'available'},{id:'shoes',category:'Shoes',name:'Black boots',status:'available'}];
const look={title:'Hard gloss',itemIds:['dress','shoes'],styling:'Layer the slip over the boots.',makeup:'No product.',reasoning:'Contrasting textures.'};
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
test('selection sends only item metadata and feedback; rejects hallucinated provider IDs',async()=>{
  let payload;
  const request={items:items.map(x=>({...x,image:photo})),history:[{rating:4}],creativity:9};
  assert.deepEqual(await perform('select',request,adapter(async(url,init)=>{
    assert.ok(url.endsWith('/responses'));
    payload=JSON.parse(init.body);
    return modelResult(look);
  })),look);
  assert.equal(payload.store,false);
  assert.equal(payload.text.format.strict,true);
  assert.ok(payload.input[0].content[0].text.includes('"rating":4'));
  assert.ok(!JSON.stringify(payload).includes('base64'));
  await assert.rejects(perform('select',request,adapter(async()=>modelResult({...look,itemIds:['invented','dress']}))),/missing or unavailable/);
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
