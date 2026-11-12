// Finds face, neckline and hands in a finished portrait, on this device.
// The pose model runs in a sandboxed frame with no access to the app or the network. Never calls a paid service.
import {regionsFromPoints} from './details.js';

const files = ['vendor/mediapipe/wasm/vision_wasm_internal.js', 'vendor/mediapipe/wasm/vision_wasm_internal.wasm', 'vendor/mediapipe/pose_landmarker_full.task'];
let ready, seq = 0;

function call(frame, message, transfer, ms) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { done(); reject(Error('timeout')); }, ms);
    function done() { clearTimeout(timer); removeEventListener('message', reply); }
    function reply(e) { if (e.source === frame.contentWindow && e.data?.id === id) { done(); e.data.ok ? resolve(e.data) : reject(Error('failed')); } }
    addEventListener('message', reply);
    frame.contentWindow.postMessage({...message, id}, '*', transfer);
  });
}

function finder() {
  ready ??= (async () => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.title = 'Pose finder';
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { removeEventListener('message', hello); reject(Error('timeout')); }, 20000);
      function hello(e) { if (e.source === frame.contentWindow && e.data === 'pose-ready') { clearTimeout(timer); removeEventListener('message', hello); resolve(); } }
      addEventListener('message', hello);
    });
    frame.src = new URL('pose.html', import.meta.url).href;
    document.body.append(frame);
    try {
      const [loader, wasm, model] = await Promise.all(files.map(async path => {
        const resp = await fetch(new URL(path, import.meta.url));
        if (!resp.ok) throw Error('missing');
        return resp.arrayBuffer();
      }));
      await loaded;
      await call(frame, {type: 'start', loader, wasm, model}, [loader, wasm, model], 90000);
      return frame;
    } catch (e) { frame.remove(); throw e; }
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

// Returns {v, aspect, regions}. regions holds only the areas found reliably; it may be empty.
export async function findRegions(src) {
  const image = new Image();
  image.src = src;
  await image.decode();
  const aspect = image.naturalWidth / image.naturalHeight;
  const bitmap = await createImageBitmap(image);
  const frame = await finder();
  const {points} = await call(frame, {type: 'detect', bitmap}, [bitmap], 30000);
  return {v: 1, aspect: +aspect.toFixed(4), regions: regionsFromPoints(points, aspect)};
}
