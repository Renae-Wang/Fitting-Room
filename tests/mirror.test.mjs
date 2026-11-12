import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mountMirror} from '../public/mirror.js';

function domElement() {
  const attrs = new Map();
  const classes = new Set();
  return {
    dataset:{}, style:{}, hidden:false, checked:true, value:3, readyState:2, videoWidth:480, videoHeight:640,
    textContent:'', classList:{
      toggle(name,on) { if(on) classes.add(name); else classes.delete(name); },
      contains:name=>classes.has(name), remove:name=>classes.delete(name)
    },
    setAttribute:(key,value)=>attrs.set(key,value), getAttribute:key=>attrs.get(key),
    remove(){}, focus(){}, play:async()=>{}, pause(){},
    addEventListener(){}, removeEventListener(){}
  };
}

function setup(t, media, enabled=false, options={}) {
  const elements = new Map();
  function get(key) {
    if(!elements.has(key)) elements.set(key,domElement());
    return elements.get(key);
  }
  const root=get('.mr'), container=domElement();
  root.querySelector=get; container.querySelector=get;
  root.querySelectorAll=()=>[get('[data-action="creator"]'),get('.mr-exit')];
  const doc=domElement();
  doc.body=domElement();
  doc.createElement=()=>({getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,AAAA'});
  const win=domElement(), requests=[];
  const peer=class {
    constructor(){this.sctp={maxMessageSize:64000};}
    createDataChannel(){return this.dc=win.dc={readyState:'connecting', sent:[], send(data){this.sent.push(JSON.parse(data));},close(){}};}
    async createOffer(){return {sdp:'fixture-offer'};}
    async setLocalDescription(){}
    async setRemoteDescription(){this.dc.readyState='open';this.dc.onopen();}
    addTrack(){}
    close(){}
  };
  win.RTCPeerConnection=peer;
  const globals={window:win,document:doc,RTCPeerConnection:peer,cancelAnimationFrame(){},
    navigator:{mediaDevices:{getUserMedia:media}},
    fetch:async(url)=>{
      requests.push(url);
      if(url==='/api/status') return {ok:true,json:async()=>({enabled,remaining:{realtime:1}})};
      if(url==='/api/realtime') return {ok:true,json:async()=>({value:'fixture',maxSeconds:60})};
      return {ok:true,text:async()=>'fixture-answer'};
    }};
  for(const [key,value] of Object.entries(globals)) {
    const previous=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{value,configurable:true});
    t.after(()=>{if(previous) Object.defineProperty(globalThis,key,previous); else delete globalThis[key];});
  }
  const cleanup=mountMirror(container, options);
  return {root,win, requests, get, action:key=>get('[data-action="'+key+'"]'), cleanup};
}
function stream(kind) {
  const track={enabled:true, stopped:false,stop(){this.stopped=true;},getSettings(){return {};}};
  return {track,getTracks:()=>[track],getVideoTracks:()=>kind==='video'?[track]:[],getAudioTracks:()=>kind==='audio'?[track]:[]};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('unconfigured Mirror keeps voice disabled and releases late camera permission after navigating away',async t=>{
  let grant;
  const delayed=new Promise(resolve=>grant=resolve), camera=stream('video');
  const ui=setup(t,()=>delayed);
  await settle();
  assert.equal(ui.action('voice').disabled,true);
  const activating=ui.action('camera').onclick();
  ui.cleanup(); grant(camera);
  await activating;
  assert.equal(camera.track.stopped,true);
  assert.deepEqual(ui.requests,['/api/status']);
});

test('controlled voice transport captions, explicit image sharing, muting and end-session cleanup',async t=>{
  const mic=stream('audio'), camera=stream('video');
  const ui=setup(t,async options=>options.video?camera:mic,true);
  try {
    await settle(); await ui.action('voice').onclick(); await ui.action('camera').onclick();
    assert.equal(ui.root.dataset.state,'listening');
    assert.deepEqual(ui.win.dc.sent,[]);
    ui.win.dc.onmessage({data:JSON.stringify({type:'response.output_audio_transcript.delta',delta:'Nice pleats.'})});
    assert.equal(ui.get('.mr-caption').textContent,'Nice pleats.');
    ui.action('mute').onclick();
    assert.equal(mic.track.enabled,false);
    ui.action('react').onclick();
    assert.equal(ui.win.dc.sent.length,2);
    assert.match(ui.win.dc.sent[0].item.content[0].image_url,/^data:image\/jpeg/);
    assert.equal(ui.win.dc.sent[1].type,'response.create');
    await ui.action('voice').onclick();
    assert.ok(camera.track.stopped && mic.track.stopped);
    assert.equal(ui.root.dataset.state,'idle');
  } finally {ui.cleanup();}
});

test('a frame per turn: one still goes out as you start talking, throttled, and never with the toggle off',async t=>{
  const mic=stream('audio'), camera=stream('video'), saved=[];
  const ui=setup(t,async options=>options.video?camera:mic,true,{onAutoFramesChange:v=>saved.push(v)});
  const realNow=Date.now; let clock=realNow(); Date.now=()=>clock; t.after(()=>{Date.now=realNow;});
  try {
    await settle(); await ui.action('voice').onclick(); await ui.action('camera').onclick();
    const speak=()=>ui.win.dc.onmessage({data:JSON.stringify({type:'input_audio_buffer.speech_started'})});
    speak();
    assert.equal(ui.win.dc.sent.length,1,'one frame when you start talking');
    const item=ui.win.dc.sent[0];
    assert.equal(item.type,'conversation.item.create');
    assert.match(item.item.content[0].image_url,/^data:image\/jpeg/);
    assert.equal(item.item.content[1].type,'input_text');
    assert.ok(!ui.win.dc.sent.some(e=>e.type==='response.create'),'the frame does not trigger a reply by itself');
    assert.equal(ui.get('.mr-preview-label').textContent,'Frame sent');
    clock+=1500; speak();
    assert.equal(ui.win.dc.sent.length,1,'a second start within 4 seconds sends nothing');
    clock+=5000; speak();
    assert.equal(ui.win.dc.sent.length,2,'the next turn sends a fresh frame');
    ui.action('auto-frame').checked=false; ui.action('auto-frame').onchange();
    assert.deepEqual(saved,[false],'turning it off is saved');
    assert.match(ui.get('.mr-disclosure').textContent,/Each tap sends one still image/);
    clock+=5000; speak();
    assert.equal(ui.win.dc.sent.length,2,'nothing is sent with the toggle off');
  } finally {ui.cleanup();}
});

test('a frame per turn needs the camera on',async t=>{
  const mic=stream('audio');
  const ui=setup(t,async()=>mic,true);
  try {
    await settle(); await ui.action('voice').onclick();
    ui.win.dc.onmessage({data:JSON.stringify({type:'input_audio_buffer.speech_started'})});
    assert.deepEqual(ui.win.dc.sent,[],'no camera, no frame');
    assert.match(ui.get('.mr-disclosure').textContent,/One still image per turn/,'the disclosure explains per-turn frames when it is on');
  } finally {ui.cleanup();}
});
