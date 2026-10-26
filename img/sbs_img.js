/* SBS IMG｜功能核心：R2 圖片清單、上傳、刪除與既有 Supabase 管理員登入。 */
(function (global) {
  "use strict";

  const IMAGE_BASE = "https://img.stillnessbyslowly.com/";
  const API_BASE = "https://img.stillnessbyslowly.com/_manage";
  const AUTH_URL = "https://bkjqaetxwvcdciieevvs.supabase.co";
  // 共用 Auth 的 publishable key（公開金鑰），不是 R2 金鑰。
  const AUTH_KEY = "sb_publishable_dAHoIimWgbGAF2wtIVSZfg_V8rzc200";
  const ADMIN_UIDS = new Set([
    "372c6a7f-4e6b-49fa-8228-183b46cbdede",
    "bd126b9b-aa23-42e0-85f5-4560cab8fc57",
    "7348ca2f-147d-4a3b-b9d2-a854c4a12430"
  ]);
  // 只接受圖片格式；瀏覽器無法辨識 MIME 的 RAW 等格式由副檔名補判斷。
  // 原始 File 直接上傳，不經縮圖工具修改。
  const IMAGE_EXTENSIONS = new Set([
    "jpg", "jpeg", "jpe", "png", "apng", "gif", "webp", "avif", "svg", "svgz",
    "bmp", "dib", "ico", "cur", "tif", "tiff", "heic", "heif", "hif", "jxl",
    "jp2", "j2k", "jpf", "jpx", "psd", "psb", "tga", "dds", "exr", "hdr",
    "icns", "qoi", "ppm", "pgm", "pbm", "pnm", "pam", "xbm", "xpm",
    "dng", "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2",
    "raf", "orf", "rw2", "rwl", "pef", "srw", "3fr", "fff", "iiq",
    "k25", "kdc", "mos", "mrw", "mef", "erf", "bay", "cap", "eip",
    "raw", "r3d"
  ]);
  const EXTENSION_MIME = new Map([
    ["svg", "image/svg+xml"], ["svgz", "image/svg+xml"],
    ["heic", "image/heic"], ["heif", "image/heif"], ["hif", "image/heif"],
    ["avif", "image/avif"], ["jxl", "image/jxl"], ["ico", "image/x-icon"],
    ["tif", "image/tiff"], ["tiff", "image/tiff"], ["bmp", "image/bmp"],
    ["dng", "image/x-adobe-dng"], ["cr2", "image/x-canon-cr2"],
    ["nef", "image/x-nikon-nef"], ["arw", "image/x-sony-arw"]
  ]);
  function imageExtension(name) {
    const match = /\.([a-z0-9]+)$/i.exec(String(name || ""));
    return match ? match[1].toLowerCase() : "";
  }
  function imageMime(file) {
    const mime = String(file.type || "").toLowerCase().split(";")[0];
    const ext = imageExtension(file.name);
    if (!IMAGE_EXTENSIONS.has(ext)) return null;
    // 對空白或通用 MIME 使用副檔名；其餘只接受 image/*。
    // 避免把 text/html、application/javascript 等偽裝檔案當圖片上傳。
    if (mime && mime !== "application/octet-stream" && !mime.startsWith("image/")) return null;
    return mime.startsWith("image/") ? mime : (EXTENSION_MIME.get(ext) || "application/octet-stream");
  }
  function canCreateThumbnail(file) {
    // 瀏覽器解碼支援不一致；這些格式嘗試縮圖常造成白圖或錯誤。
    // SVG 是主動內容格式，原檔保留但不送往 Canvas。
    return new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/bmp"]).has(file.type);
  }
  const PAGE_SIZE = 8;
  const PREVIEW_CAP = 20;
  const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

  function requireLibraries() {
    const required = {
      FictionSearch: global.FictionSearch?.search,
      FictionFilter: global.FictionFilter?.filter,
      FictionSort: global.FictionSort?.sort,
      FictionPaginate: global.FictionPaginate?.paginate,
      FictionStorage: global.FictionStorage?.create,
      FictionChange: global.FictionChange?.create,
      ImageCompressToSize: global.ImageCompressToSize?.compress
    };
    const missing = Object.entries(required).filter(([, fn]) => typeof fn !== "function").map(([name]) => name);
    if (missing.length) throw new Error(`軍火庫零件載入失敗：${missing.join("、")}`);
  }
  function formatSize(bytes) {
    if (!Number.isFinite(bytes)) return "未提供";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
  }
  function normalizeImage(raw) {
    return {
      id: String(raw.id || raw.key), key: String(raw.key), name: String(raw.name || raw.key),
      originalName: String(raw.originalName || raw.name || raw.key),
      displayName: typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : null,
      type: String(raw.type || "").toLowerCase(), size: Number(raw.size) || 0,
      createdAt: raw.createdAt || "1970-01-01T00:00:00.000Z",
      url: String(raw.url), thumbnailUrl: raw.thumbnailUrl || null,
      source: "R2", previewOnly: false
    };
  }
  function create() {
    requireLibraries();
    const changes = global.FictionChange.create({ name: "sbs-img" });
    const store = global.FictionStorage.create({ namespace: "sbs_img_v1" });
    const favoriteCollection = store.collection("favorites");
    const favorites = new Set();
    const pending = [];
    let images = [];
    let authClient = null;
    let session = null;
    let ready = false;
    let uploading = false;
    let deleting = false;
    let previewVersion = 0;
    let refreshVersion = 0;
    let activeRefresh = null;

    function emit(type, extra = {}) { changes.emit({ type, collection: "images", ...extra }); }
    function itemById(id) { return images.find(item => item.id === id) || null; }
    function all() { return images.map(item => ({ ...item, favorite: favorites.has(item.id) })); }
    async function init() {
      const saved = await favoriteCollection.all();
      saved.forEach(item => { if (typeof item.id === "string") favorites.add(item.id); });
      ready = true;
      emit("ready");
    }
    function list(options = {}) {
      if (!ready) return { data: [], totalItems: 0, page: 1, totalPages: 1, hasPrevious: false, hasNext: false };
      let rows = global.FictionSearch.search(all(), String(options.keyword || "").trim(), ["name", "originalName"]);
      const selectedType = options.type || "all";
      const knownTypes = new Set(["jpg", "png", "webp", "gif", "svg", "avif", "heic", "heif", "tiff", "bmp", "ico", "dng", "raw"]);
      if (selectedType !== "all") {
        rows = rows.filter(item => {
          const type = item.type.toLowerCase();
          const extension = imageExtension(item.originalName || item.key);
          const matched = selectedType === "jpg" ? ["jpg", "jpeg", "jpe"].includes(extension) :
            selectedType === "tiff" ? ["tiff", "tif"].includes(extension) :
            selectedType === "raw" ? ["raw", "cr2", "cr3", "nef", "arw", "raf", "rw2", "orf", "pef", "srw", "3fr", "dng"].includes(extension) :
            extension === selectedType || type === selectedType;
          return selectedType === "other" ? !knownTypes.has(extension) && !["jpeg", "jpe", "tif"].includes(extension) : matched;
        });
      }
      rows = global.FictionFilter.filter(rows, {
        boolean: { favorite: options.favoriteOnly ? true : null }
      });
      let sort = { field: "createdAt", direction: "desc", type: "date" };
      if (options.sort === "old") sort = { field: "createdAt", direction: "asc", type: "date" };
      if (options.sort === "name") sort = { field: "name", direction: "asc", type: "string" };
      if (options.sort === "size") sort = { field: "size", direction: "desc", type: "number" };
      return global.FictionPaginate.paginate(global.FictionSort.sort(rows, sort), {
        page: options.page || 1, pageSize: options.pageSize || PAGE_SIZE
      });
    }
    async function setFavorite(id, active) {
      if (!itemById(id)) return false;
      if (active) { await favoriteCollection.upsert({ id }); favorites.add(id); }
      else { await favoriteCollection.remove(id); favorites.delete(id); }
      emit("favorite", { id, active: !!active });
      return true;
    }
    function revokeDraft(item) {
      if (item.thumbUrl && item.thumbUrl !== item.originalUrl) URL.revokeObjectURL(item.thumbUrl);
      URL.revokeObjectURL(item.originalUrl);
    }
    function discardPending() {
      if (uploading) throw new Error("圖片正在上傳，請稍候。");
      previewVersion++;
      pending.splice(0).forEach(revokeDraft);
      emit("pending-cleared");
    }
    async function chooseFiles(fileList) {
      if (uploading) throw new Error("圖片正在上傳，請稍候。");
      const files = Array.from(fileList || []);
      const valid = files.filter(file => imageMime(file) && file.size > 0 && file.size <= MAX_IMAGE_BYTES);
      const accepted = valid.slice(0, PREVIEW_CAP);
      const rejected = files.length - accepted.length;
      discardPending();
      const version = previewVersion;
      for (const [index, file] of accepted.entries()) {
        if (version !== previewVersion) break;
        const originalUrl = URL.createObjectURL(file);
        const draft = {
          id: `local:${version}:${index}`, file, name: file.name, displayName: "", type: imageMime(file),
          size: file.size, originalUrl, thumbUrl: originalUrl, thumbBlob: null,
          thumbSize: null, thumbState: canCreateThumbnail(file) ? "processing" : "unavailable"
        };
        pending.push(draft);
        emit("pending-added");
        if (!canCreateThumbnail(file)) continue;
        try {
          const result = await global.ImageCompressToSize.compress(file, {
            maxBytes: 150 * 1024, maxWidth: 600, maxHeight: 600, type: "image/webp"
          });
          if (version !== previewVersion) break;
          draft.thumbBlob = result.blob;
          draft.thumbUrl = URL.createObjectURL(result.blob);
          draft.thumbSize = result.outputBytes;
          draft.thumbState = result.metTarget ? "done" : "partial";
          emit("thumbnail", { id: draft.id });
        } catch (error) {
          if (version !== previewVersion) break;
          draft.thumbState = "fallback";
          emit("thumbnail", { id: draft.id });
        }
      }
      return { selected: accepted.length, rejected, capped: valid.length > PREVIEW_CAP };
    }
    function setPendingName(id, name) {
      if (uploading) return false;
      const draft = pending.find(item => item.id === id);
      if (!draft) return false;
      draft.displayName = String(name ?? "").slice(0, 80);
      return true;
    }
    function removePending(id) {
      if (uploading) return false;
      const index = pending.findIndex(item => item.id === id);
      if (index < 0) return false;
      revokeDraft(pending.splice(index, 1)[0]);
      emit("pending-removed", { id });
      return true;
    }
    async function initAuth(onChange) {
      if (!global.supabase?.createClient) throw new Error("Supabase Auth 載入失敗。");
      if (authClient) return;
      authClient = global.supabase.createClient(AUTH_URL, AUTH_KEY, {
        auth: { storageKey: "happy-family-shared-admin-auth", detectSessionInUrl: false }
      });
      const update = candidate => {
        const before = session?.user?.id || "";
        session = candidate?.user?.id && ADMIN_UIDS.has(candidate.user.id) ? candidate : null;
        if (!session && before) {
          refreshVersion++;
          activeRefresh = null;
          images = [];
          emit("auth-cleared");
        }
        if (typeof onChange === "function") onChange({ admin: !!session, email: session?.user?.email || "" });
      };
      authClient.auth.onAuthStateChange((_event, candidate) => { update(candidate); });
      const { data, error } = await authClient.auth.getSession();
      if (error) throw error;
      update(data.session);
      if (data.session && !session) await authClient.auth.signOut();
    }
    async function login(email, password) {
      if (!authClient) throw new Error("登入系統尚未初始化。");
      const { data, error } = await authClient.auth.signInWithPassword({ email: String(email || "").trim(), password });
      if (error) throw new Error("登入失敗，請確認帳號與密碼。");
      if (!data.user?.id || !ADMIN_UIDS.has(data.user.id)) {
        await authClient.auth.signOut();
        throw new Error("此帳號沒有管理權限。");
      }
      session = data.session;
      return { email: data.user.email || "" };
    }
    async function logout() {
      if (!authClient) return;
      const { error } = await authClient.auth.signOut();
      if (error) throw new Error("登出失敗，請稍後再試。");
      session = null;
      refreshVersion++;
      activeRefresh = null;
      images = [];
      emit("auth-cleared");
    }
    async function apiFetch(path, options = {}) {
      if (!authClient || !session) throw new Error("請先登入管理員。");
      const { data, error } = await authClient.auth.getSession();
      if (error || !data.session?.access_token || !ADMIN_UIDS.has(data.session.user?.id)) {
        throw new Error("登入已過期，請重新登入。");
      }
      const headers = new Headers(options.headers || {});
      const bearer = `Bearer ${data.session.access_token}`;
      headers.set("Authorization", bearer);
      // 先使用原本的標準標頭，保持與現有舊版後端相容。
      // 只有新版後端明確回覆 missing_token 才改用額外標頭重試。
      async function sendImageApi(requestHeaders) {
        try {
          return await fetch(API_BASE + path, {
            ...options,
            headers: requestHeaders,
            mode: "cors",
            cache: "no-store"
          });
        } catch {
          throw new Error("無法連線到圖片 API，請檢查 Cloudflare 網址或跨網域設定。");
        }
      }
      async function parseImageApiResponse(response) {
        try {
          return await response.json();
        } catch {
          throw new Error(`圖片 API 回應異常（HTTP ${response.status}）。`);
        }
      }
      let response = await sendImageApi(headers);
      let payload = await parseImageApiResponse(response);

      if (response.status === 401 && payload?.code === "missing_token") {
        const retryHeaders = new Headers(headers);
        retryHeaders.set("X-SBS-Auth", bearer);
        response = await sendImageApi(retryHeaders);
        payload = await parseImageApiResponse(response);
      }

      if (!response.ok) {
        // 不顯示 JWT、密碼等私密值，只呈現後端的安全錯誤代碼。
        const code = typeof payload?.code === "string" ? payload.code : "";
        const upstream = Number.isInteger(payload?.upstreamStatus) ? `，Supabase HTTP ${payload.upstreamStatus}` : "";
        const detail = code ? `（${code}，HTTP ${response.status}${upstream}）` : `（HTTP ${response.status}）`;
        throw new Error(`${payload?.error || "R2 操作失敗。"}${detail}`);
      }
      return payload;
    }
    async function getBucketUsage(onProgress) {
      if (!session) throw new Error("請先登入管理員。");
      const fields = ["objectCount", "imageCount", "thumbnailCount", "otherCount", "totalBytes",
        "standardBytes", "infrequentBytes", "imageBytes", "thumbnailBytes", "otherBytes"];
      const totals = Object.fromEntries(fields.map(key => [key, 0]));
      let cursor = null;
      const seen = new Set();
      let pages = 0;
      do {
        const page = await apiFetch("/usage" + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""));
        if (++pages > 10000) throw new Error("物件數量太多，請改從 Cloudflare 儀表板查看。");
        if (!page?.totals || typeof page.totals !== "object") throw new Error("容量統計回應不完整。");
        for (const key of fields) {
          const value = Number(page.totals[key]);
          if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(totals[key] + value)) {
            throw new Error("容量統計數字無效。");
          }
          totals[key] += value;
        }
        cursor = page.cursor || null;
        if (cursor && seen.has(cursor)) throw new Error("容量統計游標重複，已停止統計。");
        if (cursor) seen.add(cursor);
        if (typeof onProgress === "function") onProgress({ ...totals, pages, done: !cursor });
      } while (cursor);
      return totals;
    }
    async function getOperationsUsage() {
      if (!session) throw new Error("請先登入管理員。");
      return apiFetch("/usage/operations");
    }
    async function refreshImages() {
      if (!session) { images = []; emit("images-cleared"); return []; }
      if (activeRefresh) return activeRefresh;
      const version = ++refreshVersion;
      const work = (async () => {
        let cursor = null;
        let rounds = 0;
        const fetched = [];
        do {
          if (++rounds > 100) throw new Error("圖片數量太多，請稍後再重新整理。");
          const path = "/images" + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");
          const page = await apiFetch(path);
          if (!Array.isArray(page.images)) throw new Error("圖片清單格式不正確。");
          fetched.push(...page.images.map(normalizeImage));
          cursor = page.cursor || null;
        } while (cursor);
        if (version !== refreshVersion || !session) return [];
        images = fetched;
        emit("images-refreshed", { count: images.length });
        return all();
      })();
      activeRefresh = work;
      try { return await work; }
      finally { if (activeRefresh === work) activeRefresh = null; }
    }
    async function uploadPending(onProgress) {
      if (!session) throw new Error("請先登入管理員。");
      if (uploading) throw new Error("已有圖片正在上傳。");
      if (!pending.length) return { succeeded: 0, failed: [], thumbnailFailures: 0, urls: [] };
      uploading = true;
      emit("upload-started");
      const results = { succeeded: 0, failed: [], thumbnailFailures: 0, urls: [] };
      const drafts = [...pending];
      try {
        for (const [index, draft] of drafts.entries()) {
          if (typeof onProgress === "function") onProgress(index + 1, drafts.length);
          try {
            const payload = await apiFetch("/images", {
              method: "POST", headers: { "Content-Type": draft.type, "X-Image-Name": encodeURIComponent(draft.name),
                "X-Image-Title": encodeURIComponent(draft.displayName.trim()) },
              body: draft.file
            });
            results.succeeded++;
            results.urls.push(payload.image.url);
            if (draft.thumbBlob && draft.thumbBlob.size <= 1024 * 1024) {
              try {
                await apiFetch(`/thumbnails?key=${encodeURIComponent(payload.image.key)}`, {
                  method: "POST", headers: { "Content-Type": "image/webp" }, body: draft.thumbBlob
                });
              } catch (error) {
                results.thumbnailFailures++;
                console.warn("圖片已上傳，但縮圖寫入失敗：", error);
              }
            } else if (draft.thumbBlob) results.thumbnailFailures++;
            const at = pending.findIndex(item => item.id === draft.id);
            if (at !== -1) { pending.splice(at, 1); revokeDraft(draft); }
            emit("upload-one", { key: payload.image.key });
          } catch (error) {
            results.failed.push({ name: draft.name, message: error.message });
          }
        }
      } finally {
        uploading = false;
        emit("upload-finished");
      }
      if (results.succeeded) {
        try { await refreshImages(); }
        catch (error) { results.refreshError = error.message; }
      }
      return results;
    }
    async function renameImage(id, displayName) {
      if (!session) throw new Error("請先登入管理員。");
      const original = itemById(id);
      if (!original) throw new Error("圖片不存在，請重新整理。");
      const name = String(displayName ?? "").normalize("NFC").trim();
      if (Array.from(name).length > 80 || /[\x00-\x1f\x7f]/.test(name)) {
        throw new Error("圖片名稱最多 80 個字，且不能包含換行。");
      }
      const response = await apiFetch(`/images?key=${encodeURIComponent(original.key)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name })
      });
      if (!response?.image || response.image.key !== original.key) throw new Error("圖片名稱更新回應異常。");
      refreshVersion++;
      activeRefresh = null;
      const updated = { ...original, name: String(response.image.name),
        originalName: String(response.image.originalName || original.originalName),
        displayName: response.image.displayName || null };
      images = images.map(item => item.id === id ? updated : item);
      emit("renamed", { id });
      return { ...updated, favorite: favorites.has(id) };
    }
    async function deleteImages(ids) {
      if (!session) throw new Error("請先登入管理員。");
      if (uploading) throw new Error("圖片正在上傳，請稍候。");
      if (deleting) throw new Error("已有刪除操作正在進行。");

      const unique = [...new Set(ids)].filter(id => itemById(id));
      const result = { deleted: [], failed: [] };
      if (!unique.length) return result;

      deleting = true;
      // 讓刪除前開始的清單讀取失效，避免舊資料重新顯示已刪除的圖片。
      refreshVersion++;
      activeRefresh = null;
      emit("delete-started", { count: unique.length });

      try {
        for (const id of unique) {
          const item = itemById(id);
          if (!item) continue;

          try {
            // 刪除 API 要的是 R2 key，不是前端產生的圖片 id。
            await apiFetch(`/images?key=${encodeURIComponent(item.key)}`, {
              method: "DELETE"
            });
          } catch (error) {
            // 單張失敗不影響其他圖片，保留原本的圖片及選取狀態。
            result.failed.push({ id, name: item.name, message: error.message });
            continue;
          }

          images = images.filter(image => image.id !== id);
          favorites.delete(id);
          result.deleted.push(id);
          emit("deleted", { id });

          // R2 已刪除成功；本機收藏移除失敗不能當作圖片刪除失敗。
          try {
            await favoriteCollection.remove(id);
          } catch (error) {
            console.warn("圖片已刪除，但本機收藏紀錄清除失敗：", error);
          }
        }
      } finally {
        deleting = false;
        emit("delete-finished", {
          deletedCount: result.deleted.length,
          failedCount: result.failed.length
        });
      }

      return result;
    }
    return Object.freeze({
      version: "2.1.0-r2-names", IMAGE_BASE, PAGE_SIZE, MAX_IMAGE_BYTES,
      init, initAuth, login, logout, isAdmin: () => !!session, isUploading: () => uploading, isDeleting: () => deleting,
      formatSize, list, all, itemById, refreshImages, uploadPending, deleteImages, renameImage,
      getBucketUsage, getOperationsUsage,
      pending: () => [...pending], chooseFiles, discardPending, removePending, setPendingName,
      setFavorite, subscribe: listener => changes.subscribe(listener)
    });
  }
  global.SbsImg = Object.freeze({ create, formatSize, IMAGE_BASE, version: "2.1.0-r2-names" });
})(window);
