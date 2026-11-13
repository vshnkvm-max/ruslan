(()=>{
// Prepare display previews without changing original files in the database.
const centeredPhotos=new WeakSet(),photoPreviewCache=new Map();
function centerProductPhoto(image){
 if(centeredPhotos.has(image)||!image.naturalWidth)return;centeredPhotos.add(image);
 const source=image.currentSrc||image.src,frame=image.closest('.photo');
 const requested=['auto','contain','cover'].includes(frame?.dataset.photoFit)?frame.dataset.photoFit:'contain';
 const cacheKey=requested+':'+source,cached=photoPreviewCache.get(cacheKey);
 const apply=(preview,fit)=>{image.style.objectFit=fit;if(frame)frame.style.backgroundColor=fit==='contain'?'#fff':'transparent';if(preview!==source)image.src=preview;};
 if(cached){apply(cached.src,cached.fit);return;}
 const remember=(preview,fit)=>{if(!source.startsWith('data:')){if(photoPreviewCache.size>=80)photoPreviewCache.delete(photoPreviewCache.keys().next().value);photoPreviewCache.set(cacheKey,{src:preview,fit});}};
 try{
  const sample=document.createElement('canvas'),ratio=Math.min(1,320/Math.max(image.naturalWidth,image.naturalHeight));
  sample.width=Math.max(1,Math.round(image.naturalWidth*ratio));sample.height=Math.max(1,Math.round(image.naturalHeight*ratio));
  const context=sample.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,sample.width,sample.height);
  const pixels=context.getImageData(0,0,sample.width,sample.height).data;
  // JPEG borders are often off-white, and a band may exist on only one side.
  const blank=index=>pixels[index+3]<24||(Math.min(pixels[index],pixels[index+1],pixels[index+2])>=232&&Math.max(pixels[index],pixels[index+1],pixels[index+2])-Math.min(pixels[index],pixels[index+1],pixels[index+2])<=18);
  let left=sample.width,right=-1,top=sample.height,bottom=-1;
  for(let y=0;y<sample.height;y++)for(let x=0;x<sample.width;x++)if(!blank((y*sample.width+x)*4)){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  if(right<left||bottom<top){const fit=requested==='cover'?'cover':'contain';remember(source,fit);apply(source,fit);return;}
  const contentRatio=Math.min(right-left+1,bottom-top+1)/Math.max(right-left+1,bottom-top+1);
  const fit=requested==='auto'?(contentRatio<0.72?'contain':'cover'):requested;
  const fillFrame=fit==='cover';
  if(fillFrame){
   // Trim a small inner inset only at detected borders to remove resampling fringes.
   if(left>0&&right-left>4)left+=2;if(right<sample.width-1&&right-left>4)right-=2;
   if(top>0&&bottom-top>4)top+=2;if(bottom<sample.height-1&&bottom-top>4)bottom-=2;
  }else{
   const pad=Math.max(2,Math.ceil(Math.max(right-left+1,bottom-top+1)*0.05));
   left=Math.max(0,left-pad);top=Math.max(0,top-pad);right=Math.min(sample.width-1,right+pad);bottom=Math.min(sample.height-1,bottom+pad);
  }
  const sourceX=left/sample.width*image.naturalWidth,sourceY=top/sample.height*image.naturalHeight;
  const width=(right-left+1)/sample.width*image.naturalWidth,height=(bottom-top+1)/sample.height*image.naturalHeight;
  const unchanged=left===0&&top===0&&right===sample.width-1&&bottom===sample.height-1;
  if(fillFrame?unchanged:width*height>image.naturalWidth*image.naturalHeight*0.92){remember(source,fit);apply(source,fit);return;}
  const output=document.createElement('canvas'),scale=Math.min(1,900/Math.max(width,height));
  output.width=Math.max(1,Math.round(width*scale));output.height=Math.max(1,Math.round(height*scale));
  const drawing=output.getContext('2d');drawing.fillStyle='#fff';drawing.fillRect(0,0,output.width,output.height);
  drawing.drawImage(image,sourceX,sourceY,width,height,0,0,output.width,output.height);
  const preview=output.toDataURL('image/jpeg',0.9);
  remember(preview,fit);
  apply(preview,fit);
 }catch{/* Keep the original image when a browser cannot inspect its pixels. */}
}
document.addEventListener('load',event=>{if(event.target instanceof HTMLImageElement&&event.target.matches('.photo > img,.product-photo'))centerProductPhoto(event.target);},true);
})();
