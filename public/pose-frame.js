// Runs only inside the sandboxed pose frame: no access to the app, its storage or the network.
// The page hands over the runtime and model as bytes, so nothing is fetched from here.
let finder;
async function start({loader, wasm, model}) {
  const loaderPath = URL.createObjectURL(new Blob([loader], {type: 'text/javascript'}));
  const binaryPath = URL.createObjectURL(new Blob([wasm], {type: 'application/wasm'}));
  finder = await Vision.PoseLandmarker.createFromOptions({wasmLoaderPath: loaderPath, wasmBinaryPath: binaryPath}, {
    baseOptions: {modelAssetBuffer: new Uint8Array(model), delegate: 'CPU'},
    runningMode: 'IMAGE', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5,
  });
}
addEventListener('message', async e => {
  if (e.source !== parent) return;
  const {id, type} = e.data || {};
  try {
    if (type === 'start') { await start(e.data); parent.postMessage({id, ok: true}, '*'); return; }
    if (type === 'detect') {
      const result = finder.detect(e.data.bitmap);
      e.data.bitmap.close?.();
      const points = (result.landmarks?.[0] || []).map(p => ({x: p.x, y: p.y, v: p.visibility ?? 0}));
      parent.postMessage({id, ok: true, points}, '*');
    }
  } catch {
    parent.postMessage({id, ok: false}, '*');
  }
});
parent.postMessage('pose-ready', '*');
