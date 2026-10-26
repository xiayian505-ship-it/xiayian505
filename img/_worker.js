/* SBS IMG Gateway | Cloudflare Pages advanced mode | 2026-10-26 short URLs v5.
 * Reconstructed from the frontend API and existing R2 object layout.
 * Original backend source is unavailable. This is not a copy of the original.
 * Deploy only after checking the diagnostic endpoint on a preview deployment.
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
// A separate R2 pointer is kept for each short URL, never a second image copy.
const SHORT_LINK_PREFIX = '_sbs_img/short_links_v1/';
const SHORT_PUBLIC_PATH = 'i/';
const SHORT_URL_PATTERN = /^[a-z0-9]+-\d{14}\.[a-z0-9]+$/;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_THUMB_BYTES = 1024 * 1024;
const CORS = { 'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers':'Authorization,X-SBS-Auth,Content-Type,X-Image-Name,X-Image-Title',
  };
function json(value, status=200) { return new Response(JSON.stringify(value), {status, headers:{...CORS,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}}); }
function fail(message, status=400) { return json({error:message},status); }
function decodeHeader(value) { try { return decodeURIComponent(value||''); } catch { return ''; } }
function extension(name) { return String(name).split('.').pop().toLowerCase(); }
function safeName(value) { return String(value||'').normalize('NFC').replace(/[\\/\x00-\x1f\x7f]/g,'_').trim().slice(0,160); }
function goodTitle(value) { const title=String(value??'').normalize('NFC').trim(); return Array.from(title).length<=80 && !/[\x00-\x1f\x7f]/.test(title); }
function isOriginal(key) { return /^images\/\d{4}\/\d{2}\/[^/]+$/.test(key) && !key.includes('..'); }
function thumbnailKey(key) { return `thumbs/${key}.webp`; }
const PUBLIC_IMAGE_BASE = 'https://img.stillnessbyslowly.com/';
function imageUrl(_request,key) { return PUBLIC_IMAGE_BASE + key.split('/').map(encodeURIComponent).join('/'); }

/*
 * Short IDs use an ASCII-only fragment of the original UUID and the actual R2
 * upload timestamp (UTC). Their spelling stays stable across rename and refresh.
 * Longer UUID fragments are used only if another image already owns the ID.
 */
function shortSlug(object, uuidLength = 12) {
  const name = object.key.split('/').at(-1);
  const uuid = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_/i.exec(name)?.[1];
  if (!uuid) return null;
  const ext = extension(name);
  if (!EXTENSIONS.has(ext)) return null;
  const uploaded = object.uploaded instanceof Date
    ? object.uploaded
    : new Date(object.uploaded || object.createdAt || '');
  if (!Number.isFinite(uploaded.getTime())) return null;
  const when = [uploaded.getUTCFullYear(),
    String(uploaded.getUTCMonth() + 1).padStart(2, '0'),
    String(uploaded.getUTCDate()).padStart(2, '0'),
    String(uploaded.getUTCHours()).padStart(2, '0'),
    String(uploaded.getUTCMinutes()).padStart(2, '0'),
    String(uploaded.getUTCSeconds()).padStart(2, '0')].join('');
  const hex = uuid.replaceAll('-', '').slice(0, uuidLength);
  const randomCode = BigInt('0x' + hex).toString(36);
  return `${randomCode}-${when}.${ext}`;
}
function pointerKey(slug) { return SHORT_LINK_PREFIX + slug + '.json'; }
function shortPublicUrl(slug) { return PUBLIC_IMAGE_BASE + SHORT_PUBLIC_PATH + slug; }

// Used by management list (backfill existing items) and by new uploads.
// If a pointer is unavailable, the original URL remains fully functional.
async function ensureShortUrl(bucket, object) {
  if (!isOriginal(object.key)) return null;
  for (const uuidLength of [12, 16, 20, 24, 28, 32]) {
    const slug = shortSlug(object, uuidLength);
    if (!slug) return null;
    const key = pointerKey(slug);
    const existing = await bucket.get(key);
    if (existing) {
      const mapping = await existing.json().catch(() => null);
      if (mapping?.key === object.key) return shortPublicUrl(slug);
      continue;
    }
    const payload = JSON.stringify({ version: 1, key: object.key });
    // A unique R2 pointer; it contains no image content or credentials.
    const created = await bucket.put(key, payload, {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' }
    });
    if (created) return shortPublicUrl(slug);
    // A concurrent request created this ID. Recheck ownership, then retry.
    const winner = await bucket.get(key);
    const winnerData = winner ? await winner.json().catch(() => null) : null;
    if (winnerData?.key === object.key) return shortPublicUrl(slug);
  }
  console.warn('SBS IMG: could not assign a unique short URL');
  return null;
}

async function safeShortUrl(bucket, object) {
  try { return await ensureShortUrl(bucket, object); }
  catch (error) {
    console.warn('SBS IMG short URL unavailable:', error?.name || 'unknown');
    return null;
  }
}

async function shortUrlForExisting(bucket, key) {
  // For deleting old images, do not create a new pointer just to remove it.
  const object = await bucket.head(key);
  if (!object) return [];
  const owned = [];
  for (const uuidLength of [12, 16, 20, 24, 28, 32]) {
    const slug = shortSlug(object, uuidLength);
    if (!slug) break;
    const pointer = pointerKey(slug);
    const existing = await bucket.get(pointer);
    if (!existing) continue;
    const data = await existing.json().catch(() => null);
    if (data?.key === key) owned.push(pointer);
  }
  return owned;
}
function imageRecord(request,item,displayName=null,shortUrl=null) {
  const key=item.key;
  const orig=item.customMetadata?.originalName || key.split('/').at(-1).replace(/^[0-9a-f-]{36}_/i,'');
  const title=displayName === null ? (item.customMetadata?.displayName ?? null) : displayName;
  return {id:key,key,name:title||orig,originalName:orig,displayName:title||null,
    type:item.httpMetadata?.contentType||'application/octet-stream',size:item.size,
    createdAt:item.uploaded?.toISOString?.() || new Date().toISOString(),
    url:imageUrl(request,key),shortUrl,thumbnailUrl:null};
}
/*
 * Authenticate every private route on the server. Do not trust client-side UID checks.
 * Prefer the standard Bearer header. A duplicate token in X-SBS-Auth provides a
 * documented fallback if an upstream proxy omits Authorization; both are always
 * verified by the same Supabase Auth endpoint. Never log either raw header.
 */
async function authorize(request) {
  const primary = request.headers.get('Authorization') || '';
  const secondary = request.headers.get('X-SBS-Auth') || '';
  const bearerValue = primary.trim() || secondary.trim();
  if (!bearerValue) return { ok: false, reason: 'missing_token' };

  const match = /^Bearer\s+(\S+)$/i.exec(bearerValue);
  if (!match) return { ok: false, reason: 'invalid_authorization_header' };

  const jwt = match[1];
  if (jwt.split('.').length !== 3) {
    return { ok: false, reason: 'invalid_token_format' };
  }

  // Supabase documents this endpoint for verifying projects with HS256 JWTs.
  // The publishable key identifies the application; the user JWT identifies
  // the person. Neither the public key nor a decoded, unverified JWT alone
  // grants administrator privileges.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${AUTH_URL}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: AUTH_PUBLIC_KEY,
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/json'
      },
      signal: controller.signal,
      redirect: 'manual',
      cache: 'no-store'
    });

    // Cloudflare Workers does not implement redirect: "error".
    // Manual redirects are rejected explicitly to avoid forwarding JWTs.
    if (response.status >= 300 && response.status < 400) {
      console.warn('SBS IMG Supabase Auth unexpected redirect:', response.status);
      return { ok: false, reason: 'upstream_redirect', upstreamStatus: response.status };
    }

    if (!response.ok) {
      console.warn('SBS IMG Supabase Auth HTTP status:', response.status);
      return {
        ok: false,
        reason: response.status === 401 || response.status === 403
          ? 'upstream_auth_rejected'
          : 'upstream_http_error',
        upstreamStatus: response.status
      };
    }

    let user;
    try {
      user = await response.json();
    } catch {
      return { ok: false, reason: 'invalid_user_response' };
    }
    if (!user || typeof user.id !== 'string') {
      return { ok: false, reason: 'invalid_user_response' };
    }
    if (!ADMIN_UIDS.has(user.id)) {
      return { ok: false, reason: 'not_admin' };
    }

    return { ok: true };
  } catch (error) {
    console.error('SBS IMG Supabase Auth request failed:', error?.name || 'unknown');
    return {
      ok: false,
      reason: error?.name === 'AbortError' ? 'upstream_timeout' : 'upstream_unavailable'
    };
  } finally {
    clearTimeout(timeout);
  }
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
    const page=await bucket.list({prefix,limit:1000,include:['httpMetadata','customMetadata'],...(cursor?{cursor}:{})});
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
  // Lazy one-time backfill: existing image objects are not moved or rewritten.
  // Batch in small groups to avoid flooding R2 for larger galleries.
  const images=[];
  for (let offset = 0; offset < objects.length; offset += 8) {
    const group = objects.slice(offset, offset + 8);
    const links = await Promise.all(group.map(item => safeShortUrl(bucket, item)));
    group.forEach((item, index) => {
      const record = imageRecord(request, item,
        typeof names[item.key] === 'string' ? names[item.key] : null,
        links[index]);
      if (awaitedThumbKeys.has(thumbnailKey(item.key))) {
        record.thumbnailUrl = imageUrl(request, thumbnailKey(item.key));
      }
      images.push(record);
    });
  }
  images.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
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
  // 副檔名優先決定已知格式；避免瀏覽器把 SVG 當成 text/plain 儲存。
  const contentType=MIME_BY_EXTENSION[extension(originalName)] || (mime && mime!=='application/octet-stream'?mime:'application/octet-stream');
  await bucket.put(key,bytes,{httpMetadata:{contentType,cacheControl:'public, max-age=3600'},customMetadata:{originalName,...(displayName?{displayName}:{})}});
  const stored = await bucket.head(key);
  const shortUrl = stored ? await safeShortUrl(bucket, stored) : null;
  return json({image:{key,url:imageUrl(request,key),shortUrl}},201);
}
async function imagesPatch(request,bucket,key) {
  if (!isOriginal(key)) return fail('圖片路徑不合法。');
  const body=await request.json().catch(()=>null);
  if (!body || !goodTitle(body.displayName)) return fail('圖片名稱不合法。');
  const object=await bucket.get(key);
  if (!object) return fail('圖片不存在。',404);
  const displayName=String(body.displayName).normalize('NFC').trim();
  // The existing gateway stores display names in a shared JSON index.
  // Preserve original bytes and object metadata; update only the name index.
  const names=await readNames(bucket);
  // 空字串是明確『回復原始檔名』，不能刪掉索引項目：舊圖片 metadata 可能有 displayName。
  names[key]=displayName;
  await bucket.put(NAME_INDEX_KEY,JSON.stringify({version:1,names}),
    {httpMetadata:{contentType:'application/json',cacheControl:'no-store'}});
  // R2 object not rewritten; previously created short pointer remains valid.
  const shortUrl = await safeShortUrl(bucket, object);
  return json({image:imageRecord(request,object,displayName,shortUrl)});
}
async function imagesDelete(bucket,key) {
  if (!isOriginal(key)) return fail('圖片路徑不合法。');
  const object=await bucket.head(key);
  if (!object) return fail('圖片不存在。',404);
  const shortPointers = await shortUrlForExisting(bucket, key);
  await bucket.delete([key,thumbnailKey(key),...shortPointers]);
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
  if (url.pathname === '/_sbs_gateway_health' && request.method === 'GET') {
    return json({
      status: bucket ? 'ok' : 'binding-missing',
      build: 'sbs-img-short-v5-20261026',
      r2Binding: Boolean(bucket),
      auth: 'requires-bearer'
    }, bucket ? 200 : 503);
  }
  if(url.pathname==='/_manage'||url.pathname.startsWith('/_manage/')) {
    const authorization = await authorize(request);
    if (!authorization.ok) {
      const serviceError = new Set(['upstream_unavailable', 'upstream_timeout', 'upstream_http_error', 'upstream_redirect']);
      const status = serviceError.has(authorization.reason) ? 503 : 401;
      // Return a safe error code and HTTP status, never the access token.
      return json({
        error: '管理員驗證失敗。',
        code: authorization.reason,
        ...(authorization.upstreamStatus ? { upstreamStatus: authorization.upstreamStatus } : {})
      }, status);
    }
    if (!bucket) return fail('R2 binding SBS_IMAGES 未設定。',503);
    const path=url.pathname.slice('/_manage'.length);
    // A protected, read-only check for confirming actual token verification.
    if (path === '/auth-check' && request.method === 'GET') {
      return json({ authorized: true, build: 'sbs-img-short-v5-20261026' });
    }
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
      if(path==='/usage/operations'&&request.method==='GET')return json({status:'not-configured',missingConfig:[]});
      return fail('找不到管理功能。',404);
    } catch(error) {console.error('SBS IMG API:',error);return fail('圖片操作失敗，請稍後再試。',500);}
  }
  // Direct original asset and thumbnail retrieval. SVG is served as an attachment
  // to prevent uploaded active content from executing on the image domain.
  if((request.method==='GET'||request.method==='HEAD') && bucket){
    let key;
    try { key=decodeURIComponent(url.pathname.slice(1)); } catch { return fail('圖片網址編碼錯誤。',400); }
    if (key.startsWith(SHORT_PUBLIC_PATH)) {
      const slug = key.slice(SHORT_PUBLIC_PATH.length);
      if (!SHORT_URL_PATTERN.test(slug)) return new Response('Not found', {status:404,headers:CORS});
      const pointer = await bucket.get(pointerKey(slug));
      if (!pointer) return new Response('Not found', {status:404,headers:CORS});
      const mapping = await pointer.json().catch(() => null);
      if (!mapping || !isOriginal(mapping.key)) return new Response('Not found', {status:404,headers:CORS});
      key = mapping.key;
    }
    if(key.startsWith('images/')||key.startsWith('thumbs/')){
      let object;
      try { object=await bucket.get(key); }
      catch (error) { console.error('SBS IMG read error:',String(error)); return fail('圖片讀取發生錯誤。',500); }
      if(!object)return new Response('Not found',{status:404,headers:CORS});
      const h=new Headers();object.writeHttpMetadata(h);
      h.set('ETag',object.httpEtag);
      h.set('X-Content-Type-Options','nosniff');
      h.set('Access-Control-Allow-Origin','*');
      if(/\.svgz?$/i.test(key)){h.set('Content-Disposition','attachment');h.set('Content-Security-Policy',"sandbox; default-src 'none'");}
      return new Response(request.method==='HEAD'?null:object.body,{headers:h});
    }
  }
  return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found',{status:404});
}
export default {fetch:route};
