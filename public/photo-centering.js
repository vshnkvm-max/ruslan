(()=>{
// Prepare display previews without changing original files in the database.
const centeredPhotos=new WeakSet(),photoPreviewCache=new Map();
function centerProductPhoto(image){
 if(centeredPhotos.has(image)||!image.naturalWidth)return;centeredPhotos.add(image);
 const source=image.currentSrc||image.src,cacheKey=source,cached=photoPreviewCache.get(cacheKey);
 if(cached){image.src=cached;return;}
 try{
  const sample=document.createElement('canvas'),ratio=Math.min(1,180/Math.max(image.naturalWidth,image.naturalHeight));
  sample.width=Math.max(1,Math.round(image.naturalWidth*ratio));sample.height=Math.max(1,Math.round(image.naturalHeight*ratio));
  const context=sample.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,sample.width,sample.height);
  const pixels=context.getImageData(0,0,sample.width,sample.height).data;
  const blank=index=>pixels[index+3]<24||(pixels[index]>242&&pixels[index+1]>242&&pixels[index+2]>242);
  let left=0,right=sample.width-1,top=0,bottom=sample.height-1;
  if([0,(sample.width-1)*4,(sample.height-1)*sample.width*4,(sample.width*sample.height-1)*4].every(blank)){
   left=sample.width;right=-1;top=sample.height;bottom=-1;
   for(let y=0;y<sample.height;y++)for(let x=0;x<sample.width;x++)if(!blank((y*sample.width+x)*4)){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
   if(right<left||bottom<top)return;
   const pad=Math.max(2,Math.ceil(Math.max(right-left+1,bottom-top+1)*0.05));
   left=Math.max(0,left-pad);top=Math.max(0,top-pad);right=Math.min(sample.width-1,right+pad);bottom=Math.min(sample.height-1,bottom+pad);
  }
  const sourceX=left/sample.width*image.naturalWidth,sourceY=top/sample.height*image.naturalHeight;
  const width=(right-left+1)/sample.width*image.naturalWidth,height=(bottom-top+1)/sample.height*image.naturalHeight;
  if(width*height>image.naturalWidth*image.naturalHeight*0.92)return;
  const output=document.createElement('canvas'),scale=Math.min(1,900/Math.max(width,height));
  output.width=Math.max(1,Math.round(width*scale));output.height=Math.max(1,Math.round(height*scale));
  const drawing=output.getContext('2d');drawing.fillStyle='#fff';drawing.fillRect(0,0,output.width,output.height);
  drawing.drawImage(image,sourceX,sourceY,width,height,0,0,output.width,output.height);
  const preview=output.toDataURL('image/jpeg',0.9);
  if(!source.startsWith('data:')){if(photoPreviewCache.size>=80)photoPreviewCache.delete(photoPreviewCache.keys().next().value);photoPreviewCache.set(cacheKey,preview);}
  image.src=preview;
 }catch{/* Keep the original image when a browser cannot inspect its pixels. */}
}
document.addEventListener('load',event=>{if(event.target instanceof HTMLImageElement&&event.target.matches('.photo > img,.product-photo'))centerProductPhoto(event.target);},true);
})();
