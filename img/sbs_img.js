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
  const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
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
      let rows = global.FictionSearch.search(all(), String(options.keyword || "").trim(), ["name"]);
      rows = global.FictionFilter.filter(rows, {
        equals: { type: options.type && options.type !== "all" ? options.type : null },
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
      const valid = files.filter(file => SUPPORTED_TYPES.has(file.type) && file.size > 0 && file.size <= MAX_IMAGE_BYTES);
      const accepted = valid.slice(0, PREVIEW_CAP);
      const rejected = files.length - accepted.length;
      discardPending();
      const version = previewVersion;
      for (const [index, file] of accepted.entries()) {
        if (version !== previewVersion) break;
        const originalUrl = URL.createObjectURL(file);
        const draft = {
          id: `local:${version}:${index}`, file, name: file.name, type: file.type,
          size: file.size, originalUrl, thumbUrl: originalUrl, thumbBlob: null,
          thumbSize: null, thumbState: file.type === "image/gif" ? "gif" : "processing"
        };
        pending.push(draft);
        emit("pending-added");
        if (file.type === "image/gif") continue;
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
      headers.set("Authorization", `Bearer ${data.session.access_token}`);
      const response = await fetch(API_BASE + path, { ...options, headers, mode: "cors", cache: "no-store" });
      let payload;
      try { payload = await response.json(); }
      catch { throw new Error(`圖片 API 回應異常（HTTP ${response.status}）。`); }
      if (!response.ok) throw new Error(payload.error || `R2 操作失敗（HTTP ${response.status}）。`);
      return payload;
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
              method: "POST", headers: { "Content-Type": draft.type, "X-Image-Name": encodeURIComponent(draft.name) },
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
    async function deleteImages(ids) {
      if (!session) throw new Error("請先登入管理員。");
      const unique = [...new Set(ids)].filter(id => itemById(id));
      const deleted = [];
      for (const id of unique) {
        await apiFetch(`/images?key=${encodeURIComponent(id)}`, { method: "DELETE" });
        images = images.filter(item => item.id !== id);
        favorites.delete(id);
        await favoriteCollection.remove(id);
        deleted.push(id);
        emit("deleted", { id });
      }
      return deleted;
    }
    return Object.freeze({
      version: "2.0.0-r2", IMAGE_BASE, PAGE_SIZE, MAX_IMAGE_BYTES,
      init, initAuth, login, logout, isAdmin: () => !!session, isUploading: () => uploading,
      formatSize, list, all, itemById, refreshImages, uploadPending, deleteImages,
      pending: () => [...pending], chooseFiles, discardPending, removePending,
      setFavorite, subscribe: listener => changes.subscribe(listener)
    });
  }
  global.SbsImg = Object.freeze({ create, formatSize, IMAGE_BASE, version: "2.0.0-r2" });
})(window);
