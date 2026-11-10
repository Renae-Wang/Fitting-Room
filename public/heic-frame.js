// Runs only inside the sandboxed converter frame: no access to the app, its storage or the network.
addEventListener('message', async e => {
  if (e.source !== parent) return;
  const {id, buffer} = e.data || {};
  try {
    const out = await heic2any({blob: new Blob([buffer], {type: 'image/heic'}), toType: 'image/jpeg', quality: 0.9});
    const jpeg = await (Array.isArray(out) ? out[0] : out).arrayBuffer();
    parent.postMessage({id, jpeg}, '*', [jpeg]);
  } catch {
    parent.postMessage({id, error: true}, '*');
  }
});
parent.postMessage('heic-ready', '*');
