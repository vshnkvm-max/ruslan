import { createGzip } from 'node:zlib';

export function acceptsGzip(req) {
  const encodings=String(req.headers['accept-encoding']||'').split(',').map(part=>part.trim().split(';'));
  const encoding=encodings.find(([name])=>name.toLowerCase()==='gzip');
  const quality=encoding?.slice(1).find(value=>value.trim().startsWith('q='));
  return Boolean(encoding&&(!quality||Number(quality.trim().slice(2))>0));
}

export function sendJson(req,res,status,data,headers={}) {
  const content=Buffer.from(JSON.stringify(data));
  const compress=content.length>=1024&&acceptsGzip(req);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Accept-Encoding',...(compress?{'Content-Encoding':'gzip'}:{'Content-Length':content.length}),...headers});
  if(!compress){res.end(content);return;}
  // zlib runs asynchronously, so compressing a large history does not block
  // requests for the storefront, health check or static files.
  const gzip=createGzip();
  res.once('close',()=>gzip.destroy());
  gzip.on('error',()=>res.destroy());
  gzip.pipe(res);gzip.end(content);
}
