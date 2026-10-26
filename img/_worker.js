/* SBS IMG Gateway | Cloudflare Pages advanced mode | readable backup edition.
 * The original deployed source was unavailable. This is a compatible reconstruction,
 * not a byte-for-byte copy. Do not overwrite a production deployment without testing.
 */
const AUTH_URL = 'https://bkjqaetxwvcdciieevvs.supabase.co';
const AUTH_PUBLIC_KEY = 'sb_publishable_dAHoIimWgbGAF2wtIVSZfg_V8rzc200';
const ADMIN_UIDS = new Set([
  '372c6a7f-4e6b-49fa-8228-183b46cbdede',
  'bd126b9b-aa23-42e0-85f5-4560cab8fc57',
  '7348ca2f-147d-4a3b-b9d2-a854c4a12430'
]);
const EXTENSIONS = new Set(('jpg jpeg jpe png apng gif webp avif svg svgz bmp dib ico cur tif tiff heic heif hif jxl jp2 j2k jpf jpx psd psb tga dds exr hdr icns qoi ppm pgm pbm pnm pam xbm xpm dng cr2 cr3 crw nef nrw arw srf sr2 raf orf rw2 rwl pef srw 3fr fff iiq k25 kdc mos mrw mef erf bay cap eip raw r3d').split(' '));
const MIME_BY_EXTENSION = {
  jpg:'image/jpeg', jpeg:'image/jpeg', jpe:'image/jpeg', png:'image/png', apng:'image/apng',
  gif:'image/gif', webp:'image/webp', avif:'image/avif', svg:'image/svg+xml',
  svgz:'image/svg+xml', bmp:'image/bmp', ico:'image/x-icon', cur:'image/x-icon',
  tif:'image/tiff', tiff:'image/tiff', heic:'image/heic', heif:'image/heif',
  hif:'image/heif', jxl:'image/jxl', jp2:'image/jp2', dng:'image/x-adobe-dng'
};
const NAME_INDEX_KEY = '_sbs_img/image_names_v1.json';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_THUMB_BYTES = 1024 * 1024;
const CORS = { 'Access-Control-Allow-Origin':'https://img.stillnessbyslowly.com',
  'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers':'Authorization,Content-Type,X-Image-Name,X-Image-Title',
  'Vary':'Origin' };
function json(value, status=200) { return new Response(JSON.stringify(value), {status, headers:{...CORS,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}}); }
function fail(message, status=400) { return json({error:message},status); }
function decodeHeader(value) { try { return decodeURIComponent(value||''); } catch { return ''; } }
function extension(name) { return String(name).split('.').pop().toLowerCase(); }
function safeName(value) { return String(value||'').normalize('NFC').replace(/[\\/\x00-\x1f\x7f]/g,'_').trim().slice(0,160); }
function goodTitle(value) { const title=String(value??'').normalize('NFC').trim(); return Array.from(title).length<=80 && !/[\x00-\x1f\x7f]/.test(title); }
function isOriginal(key) { return key.startsWith('images/') && !key.includes('/thumbnails/') && !key.startsWith('thumbs/'); }
function thumbnailKey(key) { return `thumbs/${key}.webp`; }
function imageUrl(request,key) { return new URL('/'+key.split('/').map(encodeURIComponent).join('/'),request.url).toString(); }
function imageRecord(request,item,displayName=null) {
  const key=item.key;
  const orig=item.customMetadata?.originalName || key.split('/').at(-1).replace(/^[0-9a-f-]{36}_/i,'');
  const title=displayName ?? item.customMetadata?.displayName ?? null;
  return {id:key,key,name:title||orig,originalName:orig,displayName:title||null,
    type:item.httpMetadata?.contentType||'application/octet-stream',size:item.size,
    createdAt:item.uploaded?.toISOString?.() || new Date().toISOString(),
    url:imageUrl(request,key),thumbnailUrl:null};
}
async function authorize(request) {
  const match=/^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization')||'');
  if (!match) return false;
  try {
    // Supabase Auth validates the access token; never trust only a decoded JWT payload.
    const response=await fetch(`${AUTH_URL}/auth/v1/user`, {headers:{Authorization:`Bearer ${match[1]}`,apikey:AUTH_PUBLIC_KEY},redirect:'error'});
    if (!response.ok) return false;
    const user=await response.json();
    return Boolean(user?.id && ADMIN_UIDS.has(user.id));
  } catch { return false; }
}
async function readNames(bucket) {
  const object=await bucket.get(NAME_INDEX_KEY);
  if (!object) return {};
  try { const value=await object.json(); return value && typeof value.names==='object' ? value.names : {}; }
  catch { return {}; }
}
async function listAll(bucket,prefix='images/') {
  const objects=[]; let cursor; let count=0;
  do {
    const page=await bucket.list({prefix,limit:1000,...(cursor?{cursor}:{})});
    objects.push(...page.objects);
    cursor=page.truncated?page.cursor:undefined;
    if (++count>1000) throw new Error('Too many result pages');
  } while(cursor);
  return objects;
}
async function imagesGet(request,bucket) {
  const objects=(await listAll(bucket)).filter(o=>isOriginal(o.key));
  const names=await readNames(bucket);
  const awaitedThumbKeys=new Set((await listAll(bucket,'thumbs/')).map(x=>x.key));
  const images=objects.map(o=>{
    const record=imageRecord(request,o,typeof names[o.key]==='string'?names[o.key]:null);
    if (awaitedThumbKeys.has(thumbnailKey(o.key))) record.thumbnailUrl=imageUrl(request,thumbnailKey(o.key));
    return record;
  }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  // Frontend accepts cursor, but not necessary for small private gallery datasets.
  return json({images,cursor:null});
}
async function imagesPost(request,bucket) {
  const rawName=decodeHeader(request.headers.get('X-Image-Name'));
  const originalName=safeName(rawName);
  if (!originalName || !EXTENSIONS.has(extension(originalName))) return fail('不支援的圖片格式。',415);
  const mime=(request.headers.get('Content-Type')||'').split(';')[0].toLowerCase();
  if (mime && mime!=='application/octet-stream' && !mime.startsWith('image/')) return fail('圖片 MIME 不正確。',415);
  const size=Number(request.headers.get('Content-Length')||0);
  if (size>MAX_IMAGE_BYTES) return fail('圖片超過 20 MB。',413);
  const bytes=await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength>MAX_IMAGE_BYTES) return fail('圖片大小不符規定。',413);
  const displayName=decodeHeader(request.headers.get('X-Image-Title'));
  if (!goodTitle(displayName)) return fail('圖片名稱不合法。');
  const now=new Date();
  const date=`${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}`;
  const key=`images/${date}/${crypto.randomUUID()}_${originalName}`;
  const contentType=mime && mime!=='application/octet-stream'?mime:(MIME_BY_EXTENSION[extension(originalName)]||'application/octet-stream');
  await bucket.put(key,bytes,{httpMetadata:{contentType,cacheControl:'public, max-age=3600'},customMetadata:{originalName,...(displayName?{displayName}:{})}});
  return json({image:{key,url:imageUrl(request,key)}},201);
}
async function imagesPatch(request,bucket,key) {
  if (!isOriginal(key)) return fail('圖片路徑不合法。');
  const body=await request.json().catch(()=>null);
  if (!body || !goodTitle(body.displayName)) return fail('圖片名稱不合法。');
  const object=await bucket.get(key);
  if (!object) return fail('圖片不存在。',404);
  const displayName=String(body.displayName).trim();
  // The existing gateway stores display names in a shared JSON index.
  // Preserve original bytes and object metadata; update only the name index.
  const names=await readNames(bucket);
  if (displayName) names[key]=displayName; else delete names[key];
  await bucket.put(NAME_INDEX_KEY,JSON.stringify({version:1,names}),
    {httpMetadata:{contentType:'application/json',cacheControl:'no-store'}});
  return json({image:imageRecord(request,object,displayName)});
}
async function imagesDelete(bucket,key) {
  if (!isOriginal(key)) return fail('圖片路徑不合法。');
  const object=await bucket.head(key);
  if (!object) return fail('圖片不存在。',404);
  await bucket.delete([key,thumbnailKey(key)]);
  const names=await readNames(bucket);
  if (Object.prototype.hasOwnProperty.call(names,key)) {
    delete names[key];
    await bucket.put(NAME_INDEX_KEY,JSON.stringify({version:1,names}),
      {httpMetadata:{contentType:'application/json',cacheControl:'no-store'}});
  }
  return json({success:true,key});
}
async function thumbnailsPost(request,bucket,key) {
  if (!isOriginal(key) || !(await bucket.head(key))) return fail('圖片不存在。',404);
  if ((request.headers.get('Content-Type')||'').toLowerCase()!=='image/webp') return fail('縮圖必須是 WebP。',415);
  const bytes=await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength>MAX_THUMB_BYTES) return fail('縮圖大小超出限制。',413);
  await bucket.put(thumbnailKey(key),bytes,{httpMetadata:{contentType:'image/webp',cacheControl:'public, max-age=3600'}});
  return json({success:true,key:thumbnailKey(key)});
}
async function usage(bucket) {
  const keys=await listAll(bucket,'');
  const totals={objectCount:0,imageCount:0,thumbnailCount:0,otherCount:0,totalBytes:0,standardBytes:0,
    infrequentBytes:0,imageBytes:0,thumbnailBytes:0,otherBytes:0};
  for(const item of keys){const size=Number(item.size)||0;totals.objectCount++;totals.totalBytes+=size;
    if(item.storageClass==='InfrequentAccess')totals.infrequentBytes+=size;else totals.standardBytes+=size;
    const kind=isOriginal(item.key)?'image':item.key.startsWith('thumbs/')?'thumbnail':'other';
    totals[kind+'Count']++;totals[kind+'Bytes']+=size;
  }
  return json({totals,cursor:null});
}
async function route(request,env){
  const url=new URL(request.url);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
  const bucket=env.SBS_IMAGES;
  if(!bucket)return fail('R2 binding SBS_IMAGES 未設定。',503);
  if(url.pathname.startsWith('/_manage')) {
    if(!(await authorize(request)))return fail('管理員驗證失敗。',401);
    const path=url.pathname.slice('/_manage'.length);
    const key=url.searchParams.get('key')||'';
    try {
      if(path==='/images') {
        if(request.method==='GET')return imagesGet(request,bucket);
        if(request.method==='POST')return imagesPost(request,bucket);
        if(request.method==='PATCH')return imagesPatch(request,bucket,key);
        if(request.method==='DELETE')return imagesDelete(bucket,key);
      }
      if(path==='/thumbnails'&&request.method==='POST')return thumbnailsPost(request,bucket,key);
      if(path==='/usage'&&request.method==='GET')return usage(bucket);
      if(path==='/usage/operations'&&request.method==='GET')return json({status:'not-configured',missingConfig:['CF_ACCOUNT_ID','CF_ANALYTICS_TOKEN']});
      return fail('找不到管理功能。',404);
    } catch(error) {console.error('SBS IMG API:',error);return fail('圖片操作失敗，請稍後再試。',500);}
  }
  // Direct original asset and thumbnail retrieval. SVG is served as an attachment
  // to prevent uploaded active content from executing on the image domain.
  if(request.method==='GET'||request.method==='HEAD'){
    const key=decodeURIComponent(url.pathname.slice(1));
    if(key.startsWith('images/')||key.startsWith('thumbs/')){
      const object=await bucket.get(key);
      if(!object)return new Response('Not found',{status:404});
      const h=new Headers();object.writeHttpMetadata(h);
      h.set('ETag',object.httpEtag);
      h.set('X-Content-Type-Options','nosniff');
      if(/\.svgz?$/i.test(key))h.set('Content-Disposition','attachment');
      return new Response(request.method==='HEAD'?null:object.body,{headers:h});
    }
  }
  return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found',{status:404});
}
export default {fetch:route};
