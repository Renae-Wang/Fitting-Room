// Local preview server: serves the static site in public/ on this computer only.
// Data and AI run in Supabase, so this server holds no keys and makes no paid calls.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {dirname,extname,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const project=dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.wasm':'application/wasm','.json':'application/json; charset=utf-8','.task':'application/octet-stream'};
function json(res,status,data) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(data));
}
export function makeServer({publicDir=resolve(project,'public')}={}) {
  return createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    try {
      const host=req.headers.host;
      if (!new Set(['127.0.0.1','localhost','[::1]'].map(h=>h+':'+req.socket.localPort)).has(host)) return json(res,403,{error:'Open the app through its local address.'});
      if (req.method!=='GET'&&req.method!=='HEAD') return json(res,405,{error:'Use GET.'});
      const path=new URL(req.url,'http://'+host).pathname;
      const file=resolve(publicDir,'.'+(path==='/'?'/index.html':decodeURIComponent(path)));
      const mime=types[extname(file)];
      if(!mime||!file.startsWith(publicDir+sep)||!(await stat(file)).isFile()) return json(res,404,{error:'File not found.'});
      res.writeHead(200,{'Content-Type':mime, ...(file.endsWith(sep+'index.html')?{'X-Frame-Options':'DENY'}:{})});
      res.end(req.method==='HEAD'?undefined:await readFile(file));
    } catch(e) {
      json(res,e.code==='ENOENT'?404:500,{error:e.code==='ENOENT'?'File not found.':'A local server error occurred.'});
    }
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const port=Number(process.env.PORT||4173);
  makeServer().listen(port,'127.0.0.1',()=>console.log('Open http://127.0.0.1:'+port+' in your browser.'));
}
