/* SBS IMG｜頁面互動：四分頁、右上角管理與 R2 管理 API。 */
(function (global) {
  "use strict";
  const $ = id => document.getElementById(id);
  const safeText = value => String(value ?? "");

  async function init() {
    const necessary = {
      SbsImg: global.SbsImg?.create,
      SlowlyTabs: global.SlowlyTabs?.create,
      SlowlyToast: global.SlowlyToast?.create,
      SlowlyCustomFile: global.SlowlyCustomFile?.init,
      SlowlySelect: global.SlowlySelect?.create,
      SlowlyConfirm: global.SlowlyConfirm?.show,
      SlowlyFavorite: global.SlowlyFavorite?.create,
      SlowlyClipboardCopy: global.SlowlyClipboardCopy?.copy,
      AuthPermissionUI: global.AuthPermissionUI?.create
    };
    const missing = Object.entries(necessary).filter(([, fn]) => typeof fn !== "function").map(([name]) => name);
    if (missing.length) throw new Error(`介面零件載入失敗：${missing.join("、")}。請確認軍火庫網址與網路連線。`);

    const app = global.SbsImg.create();
    const toast = global.SlowlyToast.create("#imgToast", { duration: 3000 });
    const tabs = global.SlowlyTabs.create("#imgTabs", { initial: "upload" });
    const manageDialog = $("manageDialog");
    const detailDialog = $("imageDialog");
    global.SlowlyCustomFile.init("#imagePicker");
    global.SlowlySelect.create("#imageType");
    global.SlowlySelect.create("#imageSort");

    let galleryPage = 1;
    let batchPage = 1;
    let currentDetailId = null;
    const batchSelection = new Set();
    let favoriteInstances = [];

    function feedback(message) {
      const el = $("feedback");
      el.textContent = safeText(message);
      el.hidden = !message;
    }
    function notify(message) { toast.show(message); }
    function button(label, className = "button button-quiet") {
      const el = document.createElement("button");
      el.type = "button";
      el.className = className;
      el.textContent = label;
      return el;
    }
    function text(tag, value, className = "") {
      const el = document.createElement(tag);
      el.textContent = safeText(value);
      if (className) el.className = className;
      return el;
    }
    function media(item, large = false) {
      const frame = document.createElement("div");
      frame.className = large ? "detail-image-inner" : "image-card-media";
      if (item.url) {
        const img = document.createElement("img");
        img.src = !large && item.thumbnailUrl ? item.thumbnailUrl : item.url;
        img.alt = `圖片：${item.name}`;
        img.loading = large ? "eager" : "lazy";
        img.decoding = "async";
        img.addEventListener("error", () => {
          if (img.src !== item.url) { img.src = item.url; return; }
          img.replaceWith(text("div", "無法顯示圖片", "image-load-error"));
        });
        frame.appendChild(img);
      } else {
        const fake = document.createElement("div");
        fake.className = "image-card-fallback";
        fake.dataset.shade = String(item.shade || 0);
        fake.appendChild(text("span", "示範"));
        frame.appendChild(fake);
      }
      return frame;
    }

    async function copyUrl(item) {
      if (!item?.url) return;
      try {
        await global.SlowlyClipboardCopy.copy(item.url);
        notify("已複製圖片網址");
      } catch (error) { feedback(`複製失敗：${error.message}`); }
    }

    function renderUpload() {
      const drafts = app.pending();
      $("pendingCount").textContent = String(drafts.length);
      $("uploadPreview").hidden = drafts.length === 0;
      $("uploadPreviewList").hidden = drafts.length === 0;
      const busy = app.isUploading();
      $("imageFiles").disabled = busy;
      $("clearFiles").disabled = busy || drafts.length === 0;
      $("uploadToR2").disabled = busy || drafts.length === 0 || !app.isAdmin();
      if (!busy) $("uploadToR2").textContent = "上傳圖片";
      $("imagePicker").querySelector(".slowly-file-label").textContent =
        drafts.length ? `已選 ${drafts.length} 張` : "未選圖";
      const list = $("uploadPreviewList");
      list.replaceChildren();
      for (const draft of drafts) {
        const row = document.createElement("article");
        row.className = "upload-item";
        const img = document.createElement("img");
        img.src = draft.thumbUrl;
        img.alt = `待上傳圖片：${draft.name}`;
        img.className = "upload-item-image";
        const info = document.createElement("div");
        info.className = "upload-item-text";
        info.appendChild(text("strong", draft.name));
        const remove = button("移除", "button button-quiet button-small");
        remove.disabled = busy;
        remove.setAttribute("aria-label", `從待上傳清單移除 ${draft.name}`);
        remove.addEventListener("click", () => {
          app.removePending(draft.id);
          if (!app.pending().length) global.SlowlyCustomFile.reset("#imagePicker");
          notify("已從待上傳預覽移除");
        });
        row.append(img, info, remove);
        list.appendChild(row);
      }
    }

    function renderUploadedResults(urls) {
      const container = $("uploadedResult");
      container.replaceChildren();
      for (const url of urls) {
        const row = document.createElement("div");
        row.className = "uploaded-result-row";
        const img = document.createElement("img");
        img.src = url;
        img.alt = "已上傳圖片";
        img.loading = "lazy";
        const copy = button("複製網址", "button button-primary button-small");
        copy.addEventListener("click", () => copyUrl({ url }));
        row.append(img, copy);
        container.appendChild(row);
      }
      container.hidden = urls.length === 0;
    }

    function galleryOptions() {
      return { keyword: $("imageSearch").value, type: $("imageType").value,
        sort: $("imageSort").value, favoriteOnly: $("favoriteOnly").checked, page: galleryPage };
    }
    function clearFavoriteInstances() {
      favoriteInstances.forEach(instance => instance.destroy());
      favoriteInstances = [];
    }

    function renderGallery() {
      const result = app.list(galleryOptions());
      galleryPage = result.page;
      clearFavoriteInstances();
      $("galleryGrid").replaceChildren();
      $("galleryEmpty").hidden = result.totalItems > 0;
      $("galleryEmpty").textContent = app.isAdmin() ? "沒有圖片" : "請先登入";
      $("gallerySummary").textContent = `${result.totalItems} 張`;
      for (const item of result.data) {
        const card = document.createElement("article");
        card.className = "image-card";
        const visual = media(item);
        const favorite = button("", "slowly-favorite favorite-button");
        favorite.dataset.favoriteId = item.id;
        favorite.setAttribute("aria-label", `收藏 ${item.name}`);
        const favoriteGlyph = text("span", "☆", "favorite-glyph");
        favorite.appendChild(favoriteGlyph);
        visual.appendChild(favorite);
        const body = document.createElement("div");
        body.className = "image-card-body";
        body.appendChild(text("strong", item.name, "image-card-title"));
        const actions = document.createElement("div");
        actions.className = "image-card-actions";
        const detail = button("查看", "button button-quiet button-small");
        detail.addEventListener("click", () => openDetail(item.id));
        const copy = button("複製網址", "button button-accent button-small");
        copy.disabled = !item.url;
        copy.addEventListener("click", () => copyUrl(item));
        actions.append(detail, copy);
        body.appendChild(actions);
        card.append(visual, body);
        $("galleryGrid").appendChild(card);
        const instance = global.SlowlyFavorite.create(favorite, {
          initial: item.favorite,
          render({ active }) { favoriteGlyph.textContent = active ? "★" : "☆"; favorite.setAttribute("aria-label", `${active ? "取消收藏" : "收藏"} ${item.name}`); },
          onChange({ active }) { app.setFavorite(item.id, active).catch(error => feedback(`收藏失敗：${error.message}`)); }
        });
        favoriteInstances.push(instance);
      }
      $("galleryPager").hidden = result.totalPages <= 1;
      $("galleryPageLabel").textContent = `第 ${result.page} / ${result.totalPages} 頁`;
      $("galleryPrev").disabled = !result.hasPrevious;
      $("galleryNext").disabled = !result.hasNext;
    }

    function renderBatch() {
      const result = app.list({ sort: "new", page: batchPage });
      batchPage = result.page;
      $("batchGrid").replaceChildren();
      for (const item of result.data) {
        const card = button("", "image-card batch-card");
        card.setAttribute("aria-pressed", String(batchSelection.has(item.id)));
        card.setAttribute("aria-label", `${batchSelection.has(item.id) ? "取消選取" : "選取"} ${item.name}`);
        const visual = media(item);
        visual.appendChild(text("span", batchSelection.has(item.id) ? "✓" : "＋", "batch-check"));
        const body = document.createElement("div");
        body.className = "image-card-body";
        body.append(text("strong", item.name, "image-card-title"));
        card.append(visual, body);
        card.addEventListener("click", () => {
          if (batchSelection.has(item.id)) batchSelection.delete(item.id);
          else batchSelection.add(item.id);
          renderBatch();
        });
        $("batchGrid").appendChild(card);
      }
      const selected = batchSelection.size;
      $("batchCount").textContent = String(selected);
      for (const id of ["batchClear", "batchFavorite", "batchUnfavorite", "batchRemove"]) $(id).disabled = !selected || app.isUploading() || !app.isAdmin();
      $("batchSelectPage").disabled = result.data.length === 0 || app.isUploading() || !app.isAdmin();
      $("batchPager").hidden = result.totalPages <= 1;
      $("batchPageLabel").textContent = `第 ${result.page} / ${result.totalPages} 頁`;
      $("batchPrev").disabled = !result.hasPrevious;
      $("batchNext").disabled = !result.hasNext;
    }

    function renderAll() {
      renderUpload();
      renderGallery();
      renderBatch();
    }

    function infoPair(parent, label, value) {
      parent.append(text("dt", label), text("dd", value));
    }
    function openDetail(id) {
      const item = app.itemById(id);
      if (!item) return;
      currentDetailId = id;
      $("detailTitle").textContent = item.name;
      $("detailPreview").replaceChildren(media(item, true));
      const info = $("detailInfo");
      info.replaceChildren();
      infoPair(info, "類型", item.type.toUpperCase());
      infoPair(info, "大小", app.formatSize(item.size));
      infoPair(info, "圖片網址", item.url);
      $("detailCopy").disabled = !item.url;
      detailDialog.showModal();
    }

    async function removeImages(ids) {
      if (!app.isAdmin()) { feedback("請先登入管理員。"); return; }
      if (app.isUploading()) { feedback("圖片上傳中，請稍候。"); return; }
      const valid = [...new Set(ids)].filter(id => app.itemById(id));
      if (!valid.length) return;
      const yes = await global.SlowlyConfirm.show({
        title: `永久刪除 ${valid.length} 張圖片？`,
        message: "刪除後無法復原，文章中正在使用的圖片也會失效。",
        confirmText: "永久刪除", cancelText: "取消", className: "sbs-img-confirm"
      });
      if (!yes) return;
      try {
        const deleted = await app.deleteImages(valid);
        deleted.forEach(id => batchSelection.delete(id));
        renderBatch();
        if (currentDetailId && deleted.includes(currentDetailId)) { detailDialog.close(); currentDetailId = null; }
        notify(`已刪除 ${deleted.length} 張圖片`);
      } catch (error) {
        feedback(`刪除失敗：${error.message}。清單正在重新整理。`);
        await app.refreshImages().catch(refreshError => feedback(`圖片庫重新整理失敗：${refreshError.message}`));
      }
    }

    const authUI = global.AuthPermissionUI.create({
      root: manageDialog,
      async onLogin({ account, password }, ui) {
        const user = await app.login(account, password);
        ui.setState({ role: "admin", permissions: ["manage"] });
        $("loggedInEmail").textContent = user.email;
        $("authIndicator").classList.add("is-online");
        ui.clearPassword();
        manageDialog.close();
        notify("管理員登入成功");
      },
      async onLogout(ui) {
        try {
          await app.logout();
          ui.setState({ role: "guest", permissions: [] });
          manageDialog.close();
          notify("已登出");
        } catch (error) { ui.setMessage(error.message || "登出失敗"); }
      },
      loginErrorText(error) { return error?.message === "此帳號沒有管理權限。" ? error.message : "登入失敗，請檢查帳號與密碼或稍後重試。"; }
    });
    function updateAuth({ admin, email }) {
      authUI.setState({ role: admin ? "admin" : "guest", permissions: admin ? ["manage"] : [] });
      $("authIndicator").classList.toggle("is-online", admin);
      $("loggedInEmail").textContent = admin ? email : "—";
      $("manageTitle").textContent = admin ? "管理員" : "管理員登入";
      if (admin) {
        // Supabase auth state 回呼期間不直接呼叫其他 Auth 方法，避免重入鎖定。
        setTimeout(() => {
          if (app.isAdmin()) app.refreshImages().catch(error => feedback(`無法載入圖片庫：${error.message}`));
        }, 0);
      } else {
        batchSelection.clear();
        renderAll();
      }
    }

    $("manageButton").addEventListener("click", () => { authUI.setMessage(""); manageDialog.showModal(); });
    $("closeManage").addEventListener("click", () => manageDialog.close());
    $("closeDetail").addEventListener("click", () => detailDialog.close());
    for (const dialog of [manageDialog, detailDialog]) dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
    manageDialog.addEventListener("close", () => authUI.clearPassword());
    detailDialog.addEventListener("close", () => { currentDetailId = null; });

    $("imageFiles").addEventListener("change", async event => {
      try {
        const result = await app.chooseFiles(event.target.files);
        renderUploadedResults([]);
        if (result.rejected) notify(`未加入 ${result.rejected} 張（僅支援 JPG、PNG、WebP、GIF，單張最多 20 MB）`);
        else if (result.selected) notify(`已選擇 ${result.selected} 張`);
      } catch (error) { feedback(`預覽失敗：${error.message}`); }
    });
    $("clearFiles").addEventListener("click", () => {
      try { app.discardPending(); global.SlowlyCustomFile.reset("#imagePicker"); notify("已清除本次選圖"); }
      catch (error) { feedback(error.message); }
    });
    $("uploadToR2").addEventListener("click", async () => {
      const uploadButton = $("uploadToR2");
      uploadButton.disabled = true;
      feedback("");
      try {
        const result = await app.uploadPending((done, total) => {
          uploadButton.textContent = `上傳中 ${done}/${total}`;
        });
        if (result.succeeded) {
          renderUploadedResults(result.urls);
          global.SlowlyCustomFile.reset("#imagePicker");
          notify(`已上傳 ${result.succeeded} 張圖片`);
        }
        if (result.failed.length) feedback(`上傳失敗：${result.failed.map(item => item.name).join("、")}。可以再按上傳重試。`);
        else if (result.refreshError) feedback(`圖片已上傳，但圖片庫重新整理失敗：${result.refreshError}`);
        else if (result.thumbnailFailures) notify(`圖片已上傳；${result.thumbnailFailures} 張縮圖未完成`);
      } catch (error) { feedback(`上傳失敗：${error.message}`); }
      finally { uploadButton.textContent = "上傳圖片"; renderUpload(); }
    });

    $("refreshGallery").addEventListener("click", async () => {
      if (!app.isAdmin()) { feedback("請先登入管理員。"); return; }
      const btn = $("refreshGallery");
      btn.disabled = true;
      try { await app.refreshImages(); notify("已更新圖片庫"); }
      catch (error) { feedback(`重新整理失敗：${error.message}`); }
      finally { btn.disabled = false; }
    });
    const resetGallery = () => { galleryPage = 1; renderGallery(); };
    $("imageSearch").addEventListener("input", resetGallery);
    $("imageType").addEventListener("change", resetGallery);
    $("imageSort").addEventListener("change", resetGallery);
    $("favoriteOnly").addEventListener("change", resetGallery);
    $("galleryPrev").addEventListener("click", () => { galleryPage--; renderGallery(); });
    $("galleryNext").addEventListener("click", () => { galleryPage++; renderGallery(); });
    $("batchPrev").addEventListener("click", () => { batchPage--; renderBatch(); });
    $("batchNext").addEventListener("click", () => { batchPage++; renderBatch(); });
    $("batchSelectPage").addEventListener("click", () => {
      app.list({ page: batchPage, sort: "new" }).data.forEach(item => batchSelection.add(item.id));
      renderBatch();
    });
    $("batchClear").addEventListener("click", () => { batchSelection.clear(); renderBatch(); });
    $("batchFavorite").addEventListener("click", async () => {
      try { for (const id of batchSelection) await app.setFavorite(id, true); notify(`已將 ${batchSelection.size} 張加入本機收藏`); }
      catch (error) { feedback(`批次收藏失敗：${error.message}`); }
    });
    $("batchUnfavorite").addEventListener("click", async () => {
      try { for (const id of batchSelection) await app.setFavorite(id, false); notify(`已取消 ${batchSelection.size} 張本機收藏`); }
      catch (error) { feedback(`批次操作失敗：${error.message}`); }
    });
    $("batchRemove").addEventListener("click", () => removeImages([...batchSelection]));
    $("detailCopy").addEventListener("click", () => copyUrl(app.itemById(currentDetailId)));
    $("detailRemove").addEventListener("click", () => currentDetailId && removeImages([currentDetailId]));
    tabs.root.addEventListener("slowlytabschange", () => feedback(""));
    app.subscribe(() => renderAll());

    renderAll();
    await app.init();
    try { await app.initAuth(updateAuth); }
    catch (error) { $("authFeedback").textContent = `無法登入：${error.message}`; $("authFeedback").hidden = false; feedback("登入服務連線失敗。"); }
  }

  init().catch(error => {
    const el = $("feedback");
    if (el) { el.textContent = `前端初始化失敗：${error.message}`; el.hidden = false; }
    console.error("SBS IMG 初始化失敗", error);
  });
})(window);
