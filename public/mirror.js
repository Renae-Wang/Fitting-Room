// The face is independent of the transport. Its mouth receives normalized audio energy.
const face = `<svg class="mr-face" viewBox="0 0 420 400" role="img" aria-label="A monochrome fashion critic with an angular bob, raised brow, and oxblood earring">
  <g fill="#1b1b1a">
    <path d="M39 399q13-34 90-51l37-16 76-4 46 16q75 12 101 55z"/>
    <path d="M84 263q-2-42 8-93 1-87 58-126 46-32 99-16 58 6 85 71 22 52 15 169l-76 6-126-9z"/>
  </g>
  <path fill="#f5f1e9" stroke="#1b1b1a" stroke-width="5" d="M168 255q16 43-4 80l36 38 52-39q-27-28-14-85z"/>
  <path d="M171 266q16 35 46 44l23-35z" fill="#1b1b1a"/>
  <path fill="#f5f1e9" stroke="#1b1b1a" stroke-width="5" d="M133 126q27-36 73-39 61-6 89 40l-6 80q10-15 18-8 10 10-3 30-8 12-18 10-13 39-43 62-13 10-26 10-36-3-66-41-24-30-25-64z"/>
  <path d="M111 184q-2-79 40-116 52-45 104-14 57 23 62 122l-32 8-5-45-30-33 14 30q-35-12-57-39 3 12 11 22-35-15-49-30-6 43-58 95z" fill="#1b1b1a"/>
  <g fill="none" stroke="#1b1b1a" stroke-linecap="round">
    <path class="mr-brow-left" stroke-width="7" d="M142 167q20-10 42-4"/>
    <path class="mr-brow-right" stroke-width="7" d="M228 151q24-15 43-7"/>
  </g>
  <g class="mr-eyes" stroke="#1b1b1a" stroke-width="4" stroke-linejoin="round" fill="#fff">
    <path d="M139 183q23-11 49 0-22 13-49 0z"/><path d="M225 174q25-20 48-12-16 24-48 12z"/>
    <g fill="#1b1b1a" stroke="none"><ellipse cx="159" cy="182" rx="5" ry="5.5"/><ellipse cx="247" cy="168" rx="5" ry="7"/></g>
  </g>
  <path d="M208 180q-2 19-11 39 3 4 12 3" fill="none" stroke="#1b1b1a" stroke-width="4" stroke-linecap="round"/>
  <path class="mr-mouth" d="M184 251q17-2 34-6 4-1 8-1-19 9-42 7z" fill="#1b1b1a"/>
  <path fill="none" stroke="#60172d" stroke-width="7" d="M298 233c-12-2-20 32-8 37 13 6 24-31 12-35"/>
  <path fill="#1b1b1a" d="M158 324l41 44 48-44 29 14-26 61H158l-22-56z"/>
</svg>`;

const sassLevels = ['Professional stylist','Friendly','Playfully sarcastic','Sassy fashion critic','Maximum drama'];
const stopTracks = stream => stream?.getTracks().forEach(track => track.stop());

function mediaMessage(error, device) {
  if (!navigator.mediaDevices?.getUserMedia) return `Open Mirror on localhost or HTTPS to use your ${device}.`;
  if (error.name === 'NotAllowedError') return `Allow ${device} access in this site's browser settings, then try again.`;
  if (error.name === 'NotFoundError') return `No ${device} was found. Connect one and try again.`;
  if (error.name === 'NotReadableError') return `Your ${device} is busy. Close the app using it and try again.`;
  return error.message || `Couldn't start the ${device}.`;
}

function captureFrame(video, limit) {
  if (!video.videoWidth || !video.videoHeight) throw new Error('Wait for the camera preview, then try again.');
  const canvas = document.createElement('canvas');
  let scale = Math.min(1, 1000 / Math.max(video.videoWidth, video.videoHeight));
  while (scale > 0.04) {
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/jpeg', .78);
    if (image.length + 1200 < limit) return image;
    scale *= .75;
  }
  throw new Error('The frame could not fit this connection. Try again.');
}

async function localRequest(path, body, signal) {
  const resp = await fetch('/api/' + path, body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal} : {signal});
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
export function mountMirror(container, {getContext = async () => ({}), onSassChange, request = localRequest, autoFrames = true, onAutoFramesChange} = {}) {
  container.innerHTML = `<section class="mr" data-state="idle" aria-labelledby="mr-title">
    <header class="mr-heading"><div><h1 id="mr-title">Mirror<span>.</span></h1><p>Your fitting room, with commentary.</p></div><button type="button" data-action="creator" aria-pressed="false">Creator mode</button></header>
    <div class="mr-grid">
      <div class="mr-stage">
        <div class="mr-stage-top"><span class="mr-state" role="status"><i></i><span>Idle</span></span><span class="mr-mic-indicator" hidden>Mic on</span><button type="button" class="mr-exit" data-action="creator">Exit creator mode</button></div>
        ${face}
        <div class="mr-preview" hidden><video autoplay muted playsinline></video><span class="mr-preview-label">Camera on</span></div>
        <div class="mr-caption" hidden></div>
      </div>
      <div class="mr-controls">
        <div class="mr-actions"><button type="button" class="mr-primary" data-action="voice">Start talking</button><button type="button" data-action="mute" hidden>Mute mic</button><button type="button" data-action="play" hidden>Enable sound</button></div>
        <p class="mr-voice-note">Starting a session shares mic audio and styling context with OpenAI.</p>
        <div class="mr-line"><div><strong>Camera</strong><p class="mr-camera-note"></p></div><button type="button" data-action="camera">Turn on camera</button></div>
        <div class="mr-actions"><button type="button" data-action="switch" hidden>Switch camera</button><button type="button" data-action="react" disabled>React to my outfit</button></div><label class="mr-check mr-auto"><input type="checkbox" data-action="auto-frame"> Share a frame each time I start talking</label><p class="mr-disclosure"></p>
        <div class="mr-settings"><label for="mr-sass">Sass <output for="mr-sass"></output></label><input id="mr-sass" type="range" min="0" max="4" step="1" value="3"><label class="mr-check"><input type="checkbox" data-action="captions" checked> Stylist captions</label></div>
        <p class="mr-feedback" role="status" hidden></p>
      </div>
    </div><audio autoplay playsinline></audio>
  </section>`;
  const root = container.querySelector('.mr');
  const el = key => root.querySelector(`[data-action="${key}"]`);
  const stateText = root.querySelector('.mr-state span');
  const note = root.querySelector('.mr-feedback');
  const preview = root.querySelector('.mr-preview'), video = root.querySelector('video'), audio = root.querySelector('audio');
  const caption = root.querySelector('.mr-caption'), mouth = root.querySelector('.mr-mouth');
  const slider = root.querySelector('#mr-sass'), output = root.querySelector('output');
  let disposed = false, voice = null, camera = null, cameraEpoch = 0, cameraBusy = false;
  let faceCamera = 'user', voiceAvailable = null, sassTouched = false;
  const alive = s => !disposed && s === voice;
  const setState = state => { root.dataset.state = state; stateText.textContent = state[0].toUpperCase() + state.slice(1); };
  const feedback = message => { note.textContent = message; note.hidden = !message; };
  const showCaption = () => { caption.hidden = !el('captions').checked || !caption.textContent; };
  function renderControls() {
    const connected = voice?.dc?.readyState === 'open';
    el('voice').textContent = !voice ? 'Start talking' : connected ? 'End session' : 'Cancel connection';
    el('voice').disabled = !voice && voiceAvailable !== true;
    const micIndicator = root.querySelector('.mr-mic-indicator');
    micIndicator.hidden = !voice?.mic;
    micIndicator.textContent = voice?.mic?.getAudioTracks()[0]?.enabled ? 'Mic on' : 'Mic muted';
    el('mute').hidden = !connected;
    el('mute').textContent = voice?.mic?.getAudioTracks()[0]?.enabled ? 'Mute mic' : 'Unmute mic';
    el('camera').textContent = cameraBusy ? 'Cancel camera' : camera ? 'Turn off camera' : 'Turn on camera';
    el('switch').hidden = !camera || cameraBusy;
    el('react').disabled = !(connected && camera && video.readyState >= 2 && !voice.pending && !voice.playing);
    preview.hidden = !camera;
    root.dataset.camera = camera ? 'on' : 'off';
  }
  function closeCamera() {
    ++cameraEpoch;
    stopTracks(camera); camera = null; cameraBusy = false; video.srcObject = null;
    renderControls();
  }
  async function openCamera(nextFacing) {
    closeCamera();
    const epoch = cameraEpoch;
    cameraBusy = true; renderControls(); feedback('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:{ideal:nextFacing},width:{ideal:1080},height:{ideal:1440}}});
      if (disposed || cameraEpoch !== epoch) { stopTracks(stream); return; }
      camera = stream;
      const track = stream.getVideoTracks()[0];
      faceCamera = track.getSettings().facingMode || nextFacing;
      track.onended = () => { if (camera === stream) { closeCamera(); feedback('Camera disconnected.'); } };
      video.style.transform = faceCamera === 'user' ? 'scaleX(-1)' : '';
      video.srcObject = stream; await video.play();
      if (!disposed && epoch === cameraEpoch) feedback('');
    } catch (err) {
      if (epoch === cameraEpoch && !disposed) { closeCamera(); feedback(mediaMessage(err,'camera')); }
    } finally {
      if (epoch === cameraEpoch && !disposed) { cameraBusy = false; renderControls(); }
    }
  }
  const restMouth = mouth.getAttribute('d');
  function stopVoice(message = '', failed = false) {
    const s = voice; voice = null;
    if (s) {
      s.abort.abort(); clearTimeout(s.timeout); clearTimeout(s.limit); clearTimeout(s.disconnected);
      cancelAnimationFrame(s.animation); stopTracks(s.mic);
      s.dc?.close(); s.pc?.close(); s.audioContext?.close().catch(()=>{});
    }
    audio.pause(); audio.srcObject = null; el('play').hidden = true;
    mouth.setAttribute('d',restMouth); caption.textContent = ''; showCaption();
    closeCamera(); setState(failed ? 'error' : 'idle'); feedback(message); renderControls();
  }
  function animateAudio(s, stream) {
    if (!s.audioContext) return;
    const analyser = s.audioContext.createAnalyser(); analyser.fftSize = 256;
    const source = s.audioContext.createMediaStreamSource(stream);
    source.connect(analyser); s.source = source;
    const samples = new Uint8Array(analyser.fftSize);
    function tick() {
      if (!alive(s)) return;
      analyser.getByteTimeDomainData(samples);
      let power = 0; for (const value of samples) power += ((value - 128) / 128) ** 2;
      const opening = Math.min(16, Math.sqrt(power / samples.length) * 90);
      mouth.setAttribute('d', opening > .55 ? `M184 251q17-${3 + opening * .5} 41-7-14 ${7 + opening * 2} -41 7z` : restMouth);
      s.animation = requestAnimationFrame(tick);
    }
    tick();
  }
  function send(s, event) { s.dc.send(JSON.stringify(event)); }
  // One still frame per turn: sent as you start talking, so the reply sees what you're wearing now.
  // At most one every 4 seconds, so short pauses and background noise don't send extra images.
  let labelTimer;
  function autoShare(s) {
    if (!autoFrames || !camera || video.readyState < 2 || s.dc?.readyState !== 'open') return;
    const now = Date.now();
    if (now - (s.lastFrame || 0) < 4000) return;
    try {
      const image = captureFrame(video, Math.min(s.pc.sctp?.maxMessageSize || 64000, 180000));
      send(s, {type:'conversation.item.create', item:{type:'message', role:'user', content:[
        {type:'input_image', image_url:image},
        {type:'input_text', text:'Camera snapshot taken automatically as I started talking. It shows what I am wearing right now. Use it when it is relevant to what I say next.'}
      ]}});
      s.lastFrame = now; s.frames = (s.frames || 0) + 1;
      const label = root.querySelector('.mr-preview-label');
      if (label) { label.textContent = 'Frame sent'; clearTimeout(labelTimer); labelTimer = setTimeout(() => { label.textContent = 'Camera on'; }, 1500); }
    } catch {}
  }
  function renderNotes() {
    root.querySelector('.mr-camera-note').textContent = autoFrames
      ? 'The preview stays on this device. A still frame goes to the stylist each time you start talking.'
      : 'Camera preview stays local until you tap React to my outfit.';
    root.querySelector('.mr-disclosure').textContent = autoFrames
      ? 'One still image per turn, plus one per tap. The camera never streams video.'
      : 'Each tap sends one still image to OpenAI.';
  }
  function onEvent(s, e) {
    if (!alive(s)) return;
    let m; try { m = JSON.parse(e.data); } catch { return; }
    switch (m.type) {
      case 'input_audio_buffer.speech_started':
        s.playing = false; setState('listening'); autoShare(s); break;
      case 'input_audio_buffer.speech_stopped':
        setState('thinking'); break;
      case 'response.created':
        s.pending = true; s.transcript = ''; caption.textContent = ''; showCaption(); setState('thinking'); break;
      case 'response.output_audio_transcript.delta':
        s.transcript += m.delta || ''; caption.textContent = s.transcript; showCaption(); break;
      case 'response.output_audio_transcript.done':
        caption.textContent = m.transcript || s.transcript; showCaption(); break;
      case 'output_audio_buffer.started':
        s.playing = true; setState('speaking'); break;
      case 'output_audio_buffer.cleared':
      case 'output_audio_buffer.stopped':
        s.playing = false; setState('listening'); break;
      case 'response.done':
        s.pending = false;
        if (m.response?.status === 'failed') { setState('error'); feedback(m.response.status_details?.error?.message || 'The stylist could not respond. Try again.'); }
        else if (!s.playing) setState('listening');
        break;
      case 'error':
        s.pending = false; setState('error'); feedback(m.error?.message || 'The voice service reported an error.'); break;
    }
    renderControls();
  }
  async function startVoice() {
    if (voice) { stopVoice(); return; }
    if (voiceAvailable !== true) return;
    const s = {abort:new AbortController(), transcript:'', pending:false, playing:false};
    voice = s; setState('connecting'); renderControls(); feedback('');
    try {
      if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) throw new Error('Voice needs a WebRTC-capable browser on localhost or HTTPS.');
      const AudioAPI = window.AudioContext || window.webkitAudioContext;
      if (AudioAPI) { s.audioContext = new AudioAPI(); s.audioContext.resume().catch(()=>{}); }
      const mic = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if (!alive(s)) { stopTracks(mic); return; }
      s.mic = mic; renderControls();
      mic.getAudioTracks()[0].onended = () => { if (alive(s)) stopVoice('Microphone disconnected.',true); };
      s.timeout = setTimeout(()=>{ if (alive(s)) stopVoice('Connection timed out. Try again.',true); },35000);
      const pc = s.pc = new RTCPeerConnection();
      const dc = s.dc = pc.createDataChannel('oai-events');
      pc.ontrack = e => {
        if (!alive(s)) return;
        const stream = e.streams[0] || new MediaStream([e.track]);
        audio.srcObject = stream; audio.play().catch(()=>{ if (alive(s)) el('play').hidden = false; });
        animateAudio(s,stream);
      };
      pc.onconnectionstatechange = () => {
        if (!alive(s)) return;
        clearTimeout(s.disconnected);
        if (pc.connectionState === 'failed') stopVoice('Voice disconnected. Start a new session.', true);
        if (pc.connectionState === 'disconnected') s.disconnected = setTimeout(()=>{ if (alive(s)) stopVoice('Voice disconnected.',true); },8000);
      };
      dc.onopen = () => { if (alive(s)) { clearTimeout(s.timeout); setState('listening'); feedback(''); renderControls(); } };
      dc.onclose = () => { if (alive(s)) stopVoice('Voice session closed.'); };
      dc.onmessage = e => onEvent(s,e);
      pc.addTrack(mic.getAudioTracks()[0],mic);
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      const context = await getContext();
      if (!alive(s)) return;
      const session = await request('realtime',{context:JSON.stringify(context),sass:Number(slider.value)},s.abort.signal);
      if (!session?.value) throw new Error('Voice session unavailable.');
      if (!alive(s)) return;
      s.limit = setTimeout(()=>{ if (alive(s)) stopVoice('Session time limit reached.'); }, (Number(session.maxSeconds) || 180) * 1000);
      const answer = await fetch('https://api.openai.com/v1/realtime/calls',{method:'POST',body:offer.sdp,headers:{Authorization:`Bearer ${session.value}`,'Content-Type':'application/sdp'},signal:s.abort.signal});
      if (!answer.ok) throw new Error(`Voice connection failed (${answer.status}). Check the configured realtime model and API access.`);
      if (alive(s)) await pc.setRemoteDescription({type:'answer',sdp:await answer.text()});
    } catch (err) {
      if (alive(s)) stopVoice(mediaMessage(err,'microphone'),true);
    }
  }
  function react() {
    const s = voice; if (el('react').disabled || !s) return;
    try {
      const limit = Math.min(s.pc.sctp?.maxMessageSize || 64000, 180000);
      const image = captureFrame(video,limit);
      send(s,{type:'conversation.item.create',item:{type:'message',role:'user',content:[
        {type:'input_image',image_url:image},
        {type:'input_text',text:'React to this just-captured outfit in one or two spoken sentences. Ground the reaction in visible styling details. Compare with the selected look only when relevant. If the frame is unclear, say so.'}
      ]}});
      send(s,{type:'response.create'});
      s.pending = true; setState('thinking'); feedback('Frame shared with the stylist.'); renderControls();
    } catch (err) { feedback(err.message); }
  }
  const renderSass = () => { output.textContent = `${slider.value} / 4 · ${sassLevels[slider.value]}`; };
  slider.oninput = () => { sassTouched = true; renderSass(); };
  slider.onchange = async () => {
    sassTouched = true; renderSass();
    if (voice?.dc?.readyState === 'open') send(voice,{type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:`Set the sass level for my next turns to ${slider.value} out of 4: ${sassLevels[slider.value]}.` }]}});
    try { await onSassChange?.(Number(slider.value)); } catch { feedback('Sass changed for this visit. Saving the preference failed.'); }
  };
  renderSass();
  Promise.resolve().then(getContext).then(context=>{ if (!disposed && !sassTouched && Number.isInteger(context?.sass)) { slider.value = context.sass; renderSass(); } }).catch(()=>{});
  request('status').then(status=>{
    if(disposed) return; voiceAvailable = Boolean(status.enabled && status.remaining?.realtime !== 0);
    if(!voiceAvailable) root.querySelector('.mr-voice-note').textContent = status.enabled ? 'The daily voice session limit has been reached.' : 'Voice needs the OpenAI key and paid calls turned on in Supabase. You can preview your camera now.';
    renderControls();
  }).catch(()=>{ if(!disposed) { voiceAvailable = false; root.querySelector('.mr-voice-note').textContent = 'Voice could not connect. Check your connection and reload.'; renderControls(); } });
  el('voice').onclick = startVoice;
  el('play').onclick = async () => { try { await audio.play(); await voice?.audioContext?.resume(); el('play').hidden = true; } catch { feedback('Audio playback is blocked by this browser.'); } };
  el('camera').onclick = () => camera || cameraBusy ? closeCamera() : openCamera(faceCamera);
  el('switch').onclick = () => openCamera(faceCamera === 'user' ? 'environment' : 'user');
  video.onloadeddata = renderControls;
  el('mute').onclick = () => { const track = voice?.mic?.getAudioTracks()[0]; if(track) { track.enabled = !track.enabled; renderControls(); } };
  el('captions').onchange = showCaption; el('react').onclick = react;
  el('auto-frame').checked = autoFrames; renderNotes();
  el('auto-frame').onchange = () => { autoFrames = Boolean(el('auto-frame').checked); renderNotes(); try { onAutoFramesChange?.(autoFrames); } catch {} };
  function setCreator(on) {
    root.classList.toggle('mr-creator',on);
    document.body.classList.toggle('mr-active-creator',on);
    el('creator').setAttribute('aria-pressed',String(on));
    if (on) { root.setAttribute('role','dialog'); root.setAttribute('aria-modal','true'); }
    else { root.removeAttribute('role'); root.removeAttribute('aria-modal'); }
    if(on) root.querySelector('.mr-exit').focus(); else el('creator').focus();
  }
  root.querySelectorAll('[data-action="creator"]').forEach(button=>button.onclick = ()=>setCreator(!root.classList.contains('mr-creator')));
  const escape = e => {
    if (!root.classList.contains('mr-creator')) return;
    if (e.key === 'Escape') { setCreator(false); return; }
    if (e.key !== 'Tab') return;
    const controls = Array.from(root.querySelectorAll('button:not(:disabled),input:not(:disabled)')).filter(button=>button.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };
  const unload = () => stopVoice();
  document.addEventListener('keydown',escape); window.addEventListener('pagehide',unload);
  renderControls();
  return () => { disposed = true; stopVoice(); document.body.classList.remove('mr-active-creator'); document.removeEventListener('keydown',escape); window.removeEventListener('pagehide',unload); root.remove(); };
}
