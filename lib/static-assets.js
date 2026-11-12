import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { digest } from './auth.js';
import { acceptsGzip } from './http-response.js';

export function createStaticAssets(root) {
  const routes={'/photo-centering.js':'photo-centering.js','/miniapp/background.svg':'miniapp/background.svg','/miniapp/important.svg':'miniapp/important.svg','/miniapp/referral.svg':'miniapp/referral.svg','/miniapp/reviews.svg':'miniapp/reviews.svg','/miniapp':'miniapp.html','/miniapp/':'miniapp.html','/miniapp.js':'miniapp.js','/miniapp.css':'miniapp.css','/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
  const sources=new Map([...new Set(Object.values(routes))].map(file=>[file,readFileSync(resolve(root,'public',file))]));
  const files=new Map();
  for(const file of new Set(Object.values(routes))) {
    const html=extname(file)==='.html';
    const raw=html?Buffer.from(sources.get(file).toString().replace(/\b(src|href)="(\/[^"?]+\.(?:js|css))"/g,(attribute,name,path)=>{
      const source=sources.get(routes[path]);return source?`${name}="${path}?v=${digest(source).slice(0,16)}"`:attribute;
    })):sources.get(file);
    const compressed=gzipSync(raw);
    files.set(file,{html,type:types[extname(file)],raw:{body:raw,etag:`"${digest(raw)}"`},gzip:compressed.length<raw.length?{body:compressed,etag:`"${digest(compressed)}"`}:null});
  }
  return function serve(req,res,path) {
    const asset=files.get(routes[path]);if(!asset)return false;
    const gzip=Boolean(asset.gzip&&acceptsGzip(req));
    const selected=gzip?asset.gzip:asset.raw;
    res.setHeader('Content-Type',asset.type);
    res.setHeader('Cache-Control',asset.html?'no-store':'no-cache');
    res.setHeader('Vary','Accept-Encoding');
    res.setHeader('ETag',selected.etag);
    if(gzip)res.setHeader('Content-Encoding','gzip');
    const matches=String(req.headers['if-none-match']||'').split(',').map(tag=>tag.trim().replace(/^W\//,''));
    if(matches.includes(selected.etag)||matches.includes('*')){res.writeHead(304);res.end();return true;}
    res.writeHead(200,{'Content-Length':selected.body.length});
    res.end(req.method==='HEAD'?undefined:selected.body);return true;
  };
}
