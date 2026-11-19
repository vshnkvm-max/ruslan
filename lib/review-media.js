import { randomUUID,createHmac,timingSafeEqual } from 'node:crypto';
import { mkdir,open,rename,unlink,stat,readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';

export function createReviewMedia(db,{directory,botToken,fail}) {
  const active=new Map();let totalActive=0,stopped=false,lastCleanup=0;
  const filePath=id=>resolve(directory,id+'.bin');
  const mac=(id,expires)=>createHmac('sha256',botToken||'unconfigured').update(`review-media:${id}:${expires}`).digest('hex');
  function url(id,privateAccess=false){const path='/api/review-media/'+id;if(!privateAccess)return path;const expires=Math.floor(Date.now()/1000)+3600;return `${path}?expires=${expires}&access=${mac(id,expires)}`;}
  function serialize(rows,{privateAccess=false,publicView=false}={}){
    const media=new Map();
    for(let start=0;start<rows.length;start+=500){const ids=rows.slice(start,start+500).map(row=>row.id);if(!ids.length)continue;
      for(const file of db.prepare(`SELECT * FROM review_media WHERE review_id IN (${ids.map(()=>'?').join(',')}) ORDER BY created_at,id`).all(...ids)){
        if(!media.has(file.review_id))media.set(file.review_id,[]);
        media.get(file.review_id).push({id:file.id,url:url(file.id,privateAccess),type:file.content_type.startsWith('image/')?'image':'video',mime:file.content_type,size:file.size});
      }
    }
    return rows.map(row=>{const value={...row,author_name:row.author_name||String(row.customer_name||'Покупатель').trim().split(/\s+/)[0].slice(0,80),media:media.get(row.id)||[]};if(publicView)delete value.customer_name;return value;});
  }
  async function cleanup(){
    if(stopped||Date.now()-lastCleanup<60000)return;lastCleanup=Date.now();
    const cutoff=new Date(Date.now()-3600000).toISOString();
    const rows=db.prepare('SELECT id FROM review_media WHERE review_id IS NULL AND created_at<?').all(cutoff);
    for(const row of rows){if(stopped)return;const removed=db.prepare('DELETE FROM review_media WHERE id=? AND review_id IS NULL AND created_at<?').run(row.id,cutoff);if(removed.changes)await unlink(filePath(row.id)).catch(()=>{});}
    for(const entry of await readdir(directory).catch(()=>[])){
      if(!/^[a-f0-9-]{36}\.part$/.test(entry))continue;
      const path=resolve(directory,entry),info=await stat(path).catch(()=>null);
      if(info&&info.mtimeMs<Date.now()-3600000)await unlink(path).catch(()=>{});
    }
  }
  function detected(bytes,type){
    if(type==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    if(type==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if(type==='image/webp')return bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if(type==='video/webm')return bytes.subarray(0,4).equals(Buffer.from([26,69,223,163]))&&bytes.includes(Buffer.from('webm'));
    if(['video/mp4','video/quicktime'].includes(type))return bytes.toString('ascii',4,8)==='ftyp'&&['isom','iso2','iso3','iso4','iso5','iso6','mp41','mp42','avc1','M4V ','MSNV','dash','qt  '].includes(bytes.toString('ascii',8,12));
    return false;
  }
  async function upload(req,c,orderId,productId,checkPurchase){
    checkPurchase(c,orderId,productId);
    const type=String(req.headers['content-type']||'').split(';')[0],video=type.startsWith('video/');
    if(!['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime'].includes(type))fail(415,'Используйте фото JPG, PNG, WebP или видео MP4, WebM, MOV.');
    const max=(video?20:5)*1024*1024;
    if(Number(req.headers['content-length'])>max){req.resume();fail(413,video?'Видео должно быть не больше 20 МБ.':'Фото должно быть не больше 5 МБ.');}
    if(totalActive>=4||(active.get(c.id)||0)>=2)fail(429,'Дождитесь завершения загрузки файлов.');
    totalActive++;active.set(c.id,(active.get(c.id)||0)+1);
    const id=randomUUID(),temporary=resolve(directory,id+'.part');let handle,complete=false;
    try{
      await mkdir(directory,{recursive:true,mode:0o700});await cleanup();
      const quota=db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(size),0) AS bytes FROM review_media WHERE customer_id=? AND review_id IS NULL').get(c.id);
      if(quota.count>=15||quota.bytes>=50*1024*1024)fail(429,'Слишком много незавершённых загрузок. Отправьте текущий отзыв или повторите позже.');
      handle=await open(temporary,'wx',0o600);let size=0,head=Buffer.alloc(0);
      for await(const chunk of req){size+=chunk.length;if(size>max)fail(413,'Файл слишком большой.');if(head.length<4096)head=Buffer.concat([head,chunk.subarray(0,4096-head.length)]);await handle.writeFile(chunk);}
      await handle.close();handle=null;
      if(!size||!detected(head,type))fail(400,'Содержимое файла не соответствует формату фото или видео.');
      checkPurchase(c,orderId,productId);
      const remaining=db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(size),0) AS bytes FROM review_media WHERE customer_id=? AND review_id IS NULL').get(c.id);
      if(remaining.count>=15||remaining.bytes+size>50*1024*1024)fail(429,'Слишком много незавершённых загрузок. Отправьте текущий отзыв или повторите позже.');
      await rename(temporary,filePath(id));
      try{db.prepare('INSERT INTO review_media(id,customer_id,order_id,product_id,content_type,size,created_at) VALUES (?,?,?,?,?,?,?)').run(id,c.id,orderId,productId,type,size,new Date().toISOString());}
      catch(error){await unlink(filePath(id)).catch(()=>{});throw error;}
      complete=true;return {id,url:url(id,true),type:video?'video':'image',mime:type,size};
    }finally{if(handle)await handle.close().catch(()=>{});if(!complete)await unlink(temporary).catch(()=>{});totalActive--;active.set(c.id,(active.get(c.id)||1)-1);}
  }
  async function serve(req,res,id,search,admin){
    const row=db.prepare(`SELECT m.*,r.status,p.deleted FROM review_media m LEFT JOIN reviews r ON r.id=m.review_id JOIN products p ON p.id=m.product_id WHERE m.id=?`).get(id);
    let permitted=Boolean(row&&row.status==='published'&&row.deleted===0)||admin;
    const expires=search.get('expires'),access=search.get('access');
    if(!permitted&&botToken&&/^\d{10}$/.test(expires||'')&&Number(expires)>=Date.now()/1000&&/^[a-f0-9]{64}$/.test(access||''))permitted=timingSafeEqual(Buffer.from(access,'hex'),Buffer.from(mac(id,expires),'hex'));
    if(!row||!permitted)fail(404,'Медиа не найдено.');
    const path=filePath(id),info=await stat(path).catch(()=>null);if(!info)fail(404,'Медиа не найдено.');
    let start=0,end=info.size-1,status=200;
    if(req.headers.range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if(!match||(!match[1]&&!match[2])){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});res.end();return;}
      if(!match[1])start=Math.max(0,info.size-Number(match[2]));else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||start>=info.size){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});res.end();return;}
      status=206;
    }
    res.writeHead(status,{'Content-Type':row.content_type,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'private, no-store',...(status===206?{'Content-Range':`bytes ${start}-${end}/${info.size}`}:{})});
    if(req.method==='HEAD'){res.end();return;}
    const stream=createReadStream(path,{start,end});res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);
  }
  async function removeReview(id){
    db.exec('BEGIN IMMEDIATE');
    let media;
    try {
      media=db.prepare('DELETE FROM review_media WHERE review_id=? RETURNING id').all(id);
      db.prepare('DELETE FROM reviews WHERE id=?').run(id);
      db.exec('COMMIT');
    } catch(error) {
      db.exec('ROLLBACK');
      throw error;
    }
    await Promise.all(media.map(file=>unlink(filePath(file.id)).catch(error=>{
      if(error.code!=='ENOENT')console.error('Не удалось удалить файл отзыва',file.id,error);
    })));
  }
  return {serialize,upload,serve,removeReview,stop(){stopped=true;}};
}
