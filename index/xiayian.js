(function () {
  "use strict";

  // Articles stay in the blog project. Administrator identities deliberately
  // come from the existing, shared Auth project.
  const BLOG_SUPABASE_URL = "https://kscbrnmhqugcwfohczve.supabase.co";
  const BLOG_SUPABASE_KEY = "sb_publishable_E00oHxUzDH-P_26ippQb5Q_d8X0-MMG";
  const ADMIN_AUTH_URL = "https://bkjqaetxwvcdciieevvs.supabase.co";
  const ADMIN_AUTH_KEY = "sb_publishable_dAHoIimWgbGAF2wtIVSZfg_V8rzc200";
  const ADMIN_UIDS = new Set([
    "372c6a7f-4e6b-49fa-8228-183b46cbdede",
    "bd126b9b-aa23-42e0-85f5-4560cab8fc57",
    "7348ca2f-147d-4a3b-b9d2-a854c4a12430"
  ]);
  const ADMIN_API_URL = `${BLOG_SUPABASE_URL}/functions/v1/blog-admin`;

  const db = window.supabase.createClient(BLOG_SUPABASE_URL, BLOG_SUPABASE_KEY, {
    auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false }
  });
  const adminAuth = window.supabase.createClient(ADMIN_AUTH_URL, ADMIN_AUTH_KEY, {
    auth: { storageKey:"happy-family-shared-admin-auth" }
  });
  const TAXONOMY_API_URL = `${BLOG_SUPABASE_URL}/functions/v1/blog-taxonomy`;
  const elements = Object.fromEntries([
    "posts","status","post-count","auth-button","new-post-button","admin-badge",
    "login-dialog","login-form","login-email","login-password","login-error",
    "editor-dialog","editor-form","editor-title","editor-error","post-id","post-title",
    "post-content","post-published","post-category","post-pages","post-prev","post-next","post-page-label",
    "category-section","category-tree","category-status","new-category-button",
    "category-dialog","category-form","category-dialog-title","category-id","category-name",
    "category-parent","category-error","category-delete","category-save"
  ].map(function (id) { return [id, document.getElementById(id)]; }));

  let session = null;
  let posts = [];
  let categories = [];
  let assignmentMap = new Map();
  let taxonomyReady = false;
  let currentPage = 1;
  let lastAdminMode = null;
  let loadVersion = 0;

  // 軍火庫管理選取／展開狀態。父子關係、顯示與儲存屬於個人頁。
  const tree = window.TreeSelection.create({ expansion:"multiple", selected:["all"] });
  const postCategorySelect = window.SlowlySelect.create("#post-category");
  const categoryParentSelect = window.SlowlySelect.create("#category-parent");

  // 軍火庫 AuthPermissionUI 僅負責顯示；原有 Supabase Auth 與管理員檢查不變。
  const authUI = window.AuthPermissionUI.create({
    root: document.body,
    async onLogin({ account, password }) {
      const { data, error } = await adminAuth.auth.signInWithPassword({ email:account.trim(), password });
      if (error) throw new Error("登入失敗，請確認帳號與密碼。");
      if (!data.user?.id || !ADMIN_UIDS.has(data.user.id)) {
        await adminAuth.auth.signOut();
        throw new Error("此帳號沒有最高管理權限。");
      }
      elements["login-dialog"].close();
    },
    loginErrorText(error) {
      const msg = error?.message;
      return msg === "登入失敗，請確認帳號與密碼。" || msg === "此帳號沒有最高管理權限。"
        ? msg : "登入失敗，請稍後再試。";
    }
  });
  const siteToast = window.SlowlyToast.create("#site-toast", { duration:4500 });

  // Rich articles are stored in the existing posts.content TEXT column.
  // The backend payload, auth, and category APIs remain unchanged.
  const ARTICLE_TAGS = [
    "p","div","br","strong","b","em","i","u","s","del","h2","h3","h4",
    "blockquote","ul","ol","li","a","img","figure","figcaption","hr",
    "pre","code","span","sub","sup","mark","small","table","thead","tbody",
    "tfoot","tr","th","td"
  ];
  const ARTICLE_ATTRIBUTES = ["href","target","rel","src","alt","title","width","height"];

  function articleURL(value, kind) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.username || url.password) return null;
      if (kind === "image") return url.protocol === "https:" ? url.href : null;
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  function sanitizeArticleHTML(value) {
    if (!window.DOMPurify?.sanitize) {
      throw new Error("文章安全元件尚未載入，請確認網路連線後重新整理。");
    }
    const clean = window.DOMPurify.sanitize(String(value || ""), {
      ALLOWED_TAGS: ARTICLE_TAGS,
      ALLOWED_ATTR: ARTICLE_ATTRIBUTES,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      FORBID_TAGS: ["script","style","iframe","object","embed","svg","math","form","input","button","video","audio","canvas","template"],
      KEEP_CONTENT: true
    });
    const template = document.createElement("template");
    template.innerHTML = clean;
    template.content.querySelectorAll("img").forEach(function (img) {
      const src = articleURL(img.getAttribute("src"), "image");
      if (!src) { img.remove(); return; }
      img.setAttribute("src", src);
      img.setAttribute("loading", "lazy");
      img.setAttribute("decoding", "async");
      if (img.hasAttribute("alt")) img.setAttribute("alt", img.getAttribute("alt").slice(0, 300));
      else img.setAttribute("alt", "文章圖片");
      ["width","height"].forEach(function (attr) {
        const raw = img.getAttribute(attr);
        if (raw !== null && (!/^\d{1,4}$/.test(raw) || Number(raw) > 3000)) img.removeAttribute(attr);
      });
    });
    template.content.querySelectorAll("a").forEach(function (anchor) {
      const href = articleURL(anchor.getAttribute("href"), "link");
      if (!href) { anchor.replaceWith(...Array.from(anchor.childNodes)); return; }
      anchor.setAttribute("href", href);
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    });
    return template.innerHTML;
  }

  function renderArticleContent(target, html) {
    try { target.innerHTML = sanitizeArticleHTML(html); }
    catch (error) {
      // Never inject unfiltered HTML when the security dependency is unavailable.
      target.textContent = String(html || "");
      console.error("article sanitizer unavailable", error);
    }
  }

  function createRichEditor() {
    const visual = document.getElementById("post-visual");
    const source = document.getElementById("post-html");
    const hidden = elements["post-content"];
    const toolbar = document.getElementById("editor-toolbar");
    const visualTab = document.getElementById("editor-visual-tab");
    const sourceTab = document.getElementById("editor-html-tab");
    const imageTools = document.getElementById("selected-image-tools");
    const replaceImageButton = document.getElementById("replace-image-button");
    const deleteImageButton = document.getElementById("delete-image-button");
    const imageDialog = document.getElementById("image-dialog");
    const imageForm = document.getElementById("image-form");
    const imageDialogTitle = document.getElementById("image-dialog-title");
    const imageDialogSubmit = document.getElementById("image-dialog-submit");
    const imageURL = document.getElementById("image-url");
    const imageAlt = document.getElementById("image-alt");
    const imageError = document.getElementById("image-error");
    const linkDialog = document.getElementById("link-dialog");
    const linkForm = document.getElementById("link-form");
    const linkURL = document.getElementById("link-url");
    const linkLabel = document.getElementById("link-label");
    const linkError = document.getElementById("link-error");
    const editorError = elements["editor-error"];
    let mode = "visual";
    let selectedRange = null;
    let selectedImage = null;
    let editingImage = null;
    let busy = false;

    function clearSelectedImage() {
      selectedImage?.classList.remove("rich-image-selected");
      selectedImage = null;
      imageTools.hidden = true;
    }

    function selectImage(image) {
      if (busy || mode !== "visual" || !image || !visual.contains(image)) return;
      clearSelectedImage();
      selectedImage = image;
      selectedImage.classList.add("rich-image-selected");
      imageTools.hidden = false;
    }

    function deleteSelectedImage() {
      if (busy || mode !== "visual" || !selectedImage || !visual.contains(selectedImage)) return;
      const image = selectedImage;
      const range = document.createRange();
      range.setStartBefore(image);
      range.collapse(true);
      clearSelectedImage();
      image.remove();
      visual.focus();
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      rememberRange();
    }

    function rememberRange() {
      if (mode !== "visual" || !visual.isConnected) return;
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (visual.contains(range.startContainer) && visual.contains(range.endContainer)) {
        selectedRange = range.cloneRange();
      }
    }
    document.addEventListener("selectionchange", rememberRange);
    ["keyup","mouseup","touchend","input"].forEach(type => visual.addEventListener(type, rememberRange));

    function restoreRange() {
      visual.focus();
      const selection = window.getSelection();
      if (!selection) return;
      if (selectedRange && visual.contains(selectedRange.startContainer) && visual.contains(selectedRange.endContainer)) {
        selection.removeAllRanges();
        selection.addRange(selectedRange);
      } else {
        const range = document.createRange();
        range.selectNodeContents(visual);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }

    function insertSafeNode(node) {
      restoreRange();
      const selection = window.getSelection();
      if (!selection?.rangeCount) { visual.appendChild(node); return; }
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      rememberRange();
    }

    function updateMode(next) {
      mode = next;
      const isVisual = mode === "visual";
      visual.hidden = !isVisual;
      source.hidden = isVisual;
      toolbar.hidden = !isVisual;
      visualTab.setAttribute("aria-selected", String(isVisual));
      sourceTab.setAttribute("aria-selected", String(!isVisual));
      visualTab.tabIndex = isVisual ? 0 : -1;
      sourceTab.tabIndex = isVisual ? -1 : 0;
      visual.contentEditable = String(isVisual && !busy);
      source.disabled = busy;
    }

    function switchMode(next) {
      if (busy || next === mode) return;
      try {
        clearSelectedImage();
        editingImage = null;
        if (next === "html") {
          const html = sanitizeArticleHTML(visual.innerHTML);
          hidden.value = html;
          source.value = html;
          updateMode("html");
          source.focus();
        } else {
          const html = sanitizeArticleHTML(source.value);
          if (html.trim() !== source.value.trim()) {
            siteToast.show("HTML 已經過安全整理，請確認排版與內容。");
          }
          hidden.value = html;
          source.value = html;
          visual.innerHTML = html;
          selectedRange = null;
          updateMode("visual");
          visual.focus();
        }
        editorError.textContent = "";
      } catch (error) { editorError.textContent = message(error); }
    }

    visualTab.addEventListener("click", () => switchMode("visual"));
    sourceTab.addEventListener("click", () => switchMode("html"));
    [visualTab,sourceTab].forEach(button => button.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      switchMode(button === visualTab ? "html" : "visual");
    }));

    toolbar.addEventListener("mousedown", event => {
      if (event.target.closest("button")) event.preventDefault();
    });
    toolbar.addEventListener("click", function (event) {
      const button = event.target.closest("[data-editor-command]");
      if (!button || busy || mode !== "visual") return;
      restoreRange();
      const command = button.dataset.editorCommand;
      const argument = button.dataset.editorValue || null;
      if (!document.execCommand(command, false, argument)) {
        siteToast.show("這個排版指令在目前的瀏覽器中不可用。");
      }
      rememberRange();
    });

    // Mobile users can tap an image instead of trying to select an IMG node
    // with the keyboard. The controls live outside contenteditable and are
    // never included in the saved article HTML.
    visual.addEventListener("click", function (event) {
      const image = event.target.closest("img");
      if (image) {
        event.preventDefault();
        selectImage(image);
      }
      else clearSelectedImage();
    });
    visual.addEventListener("keydown", function (event) {
      if (selectedImage && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        deleteSelectedImage();
      } else if (!["Shift","Control","Alt","Meta"].includes(event.key)) {
        clearSelectedImage();
      }
    });
    deleteImageButton.addEventListener("click", deleteSelectedImage);
    replaceImageButton.addEventListener("click", function () {
      if (selectedImage && visual.contains(selectedImage)) openImageDialog(selectedImage);
    });

    function pasteText(text) {
      restoreRange();
      if (!document.execCommand("insertText", false, text)) {
        insertSafeNode(document.createTextNode(text));
      }
    }
    visual.addEventListener("paste", function (event) {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      event.preventDefault();
      if (clipboard.files?.length) {
        siteToast.show("不提供圖片上傳；請先放到圖床，再用圖片網址插入。");
        return;
      }
      const pastedHTML = clipboard.getData("text/html");
      if (pastedHTML) {
        try {
          const cleaned = sanitizeArticleHTML(pastedHTML);
          restoreRange();
          if (!document.execCommand("insertHTML", false, cleaned)) pasteText(clipboard.getData("text/plain"));
        } catch (error) { editorError.textContent = message(error); }
      } else {
        pasteText(clipboard.getData("text/plain"));
      }
      rememberRange();
    });
    visual.addEventListener("drop", function (event) {
      event.preventDefault();
      siteToast.show("請透過工具列貼上圖床網址；不接受拖放上傳。");
    });

    function openImageDialog(image = null) {
      if (busy || mode !== "visual") return;
      rememberRange();
      editingImage = image && visual.contains(image) ? image : null;
      imageForm.reset(); imageError.textContent = "";
      imageDialogTitle.textContent = editingImage ? "修改圖片網址" : "插入圖床圖片";
      imageDialogSubmit.textContent = editingImage ? "儲存圖片" : "插入圖片";
      if (editingImage) {
        imageURL.value = editingImage.getAttribute("src") || "";
        imageAlt.value = editingImage.getAttribute("alt") || "";
      }
      imageDialog.showModal(); imageURL.focus();
    }
    document.getElementById("insert-image-button").addEventListener("click", function () {
      openImageDialog();
    });
    imageDialog.addEventListener("close", function () { editingImage = null; });
    imageForm.addEventListener("submit", function (event) {
      event.preventDefault();
      const src = articleURL(imageURL.value, "image");
      if (!src) { imageError.textContent = "請貼上 HTTPS 圖片直連，不支援上傳或 Base64。"; return; }
      const alt = imageAlt.value.trim().slice(0,300) || "文章圖片";
      const image = editingImage && visual.contains(editingImage) ? editingImage : null;
      imageDialog.close();
      editingImage = null;
      if (image) {
        image.src = src;
        image.alt = alt;
        selectImage(image);
      } else {
        const img = document.createElement("img");
        img.src = src; img.alt = alt;
        img.loading = "lazy"; img.decoding = "async";
        insertSafeNode(img);
        selectImage(img);
      }
      editorError.textContent = "";
    });

    document.getElementById("insert-link-button").addEventListener("click", function () {
      if (busy || mode !== "visual") return;
      rememberRange();
      linkForm.reset(); linkError.textContent = "";
      const selectedText = selectedRange?.toString().trim() || "";
      linkLabel.disabled = Boolean(selectedText);
      linkLabel.placeholder = selectedText || "未選取文字時，可輸入連結名稱";
      linkDialog.showModal(); linkURL.focus();
    });
    linkForm.addEventListener("submit", function (event) {
      event.preventDefault();
      const href = articleURL(linkURL.value, "link");
      if (!href) { linkError.textContent = "請輸入有效的 HTTP 或 HTTPS 網址。"; return; }
      linkDialog.close();
      restoreRange();
      if (selectedRange && !selectedRange.collapsed) {
        if (!document.execCommand("createLink", false, href)) {
          linkError.textContent = "連結插入失敗，請重新選取文字。";
          siteToast.show(linkError.textContent);
          return;
        }
        visual.querySelectorAll("a[href]").forEach(a => {
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        });
        rememberRange();
      } else {
        const a = document.createElement("a");
        a.href = href; a.textContent = linkLabel.value.trim() || href;
        a.target = "_blank"; a.rel = "noopener noreferrer";
        insertSafeNode(a);
      }
      editorError.textContent = "";
    });

    return {
      load(value) {
        const html = sanitizeArticleHTML(value);
        clearSelectedImage();
        editingImage = null;
        hidden.value = html;
        source.value = html;
        visual.innerHTML = html;
        selectedRange = null;
        busy = false;
        updateMode("visual");
      },
      getHTML() {
        clearSelectedImage();
        const raw = mode === "visual" ? visual.innerHTML : source.value;
        const clean = sanitizeArticleHTML(raw);
        if (mode === "html" && clean.trim() !== raw.trim()) {
          source.value = clean;
          hidden.value = clean;
          editorError.textContent = "HTML 已過濾不安全或不支援的內容，請確認後再儲存。";
          return null;
        }
        hidden.value = clean;
        return clean;
      },
      setBusy(value) {
        busy = Boolean(value);
        if (busy) clearSelectedImage();
        updateMode(mode);
      }
    };
  }
  const richEditor = createRichEditor();


  function isAdmin() { return Boolean(session?.user?.id && ADMIN_UIDS.has(session.user.id)); }
  function formatDate(value) { return new Intl.DateTimeFormat("zh-TW", { year:"numeric", month:"long", day:"numeric" }).format(new Date(value)); }
  function setBusy(form, busy) { form.querySelectorAll("button,input,textarea,select").forEach(function (node) { node.disabled = busy; }); }
  function message(error) { return error?.message || "發生未預期的錯誤，請稍後再試。"; }

  // 這個 adminRequest 函式使用原檔原本的 blog-admin；請勿改成直接寫 posts。
  async function adminRequest(path, options) {
    if (!isAdmin() || !session?.access_token) throw new Error("管理員工作階段已失效，請重新登入。");
    const response = await fetch(`${ADMIN_API_URL}${path}`, {
      method:options?.method || "GET",
      headers:{ "Authorization":`Bearer ${session.access_token}`, "Content-Type":"application/json" },
      body:options?.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(payload.error || "管理操作失敗，請稍後再試。");
    return payload;
  }


  async function taxonomyRequest(path, options) {
    if (!isAdmin() || !session?.access_token) throw new Error("管理員工作階段已失效，請重新登入。");
    const response = await fetch(`${TAXONOMY_API_URL}${path}`, {
      method:options?.method || "GET",
      headers:{ "Authorization":`Bearer ${session.access_token}`, "Content-Type":"application/json" },
      body:options?.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(payload.error || "分類操作失敗，請稍後再試。");
    return payload;
  }

  function categoryId(value) { return value === null || value === undefined ? null : String(value); }
  function categoryById(id) { return categories.find(category => String(category.id) === String(id)) || null; }
  function childrenOf(parentId) {
    return categories.filter(category => categoryId(category.parent_id) === categoryId(parentId))
      .sort((a,b) => a.name.localeCompare(b.name,"zh-Hant") || Number(a.id) - Number(b.id));
  }
  function walkCategories(visit, parentId = null, depth = 0, seen = new Set()) {
    for (const category of childrenOf(parentId)) {
      const id = String(category.id);
      if (seen.has(id)) continue;
      const next = new Set(seen); next.add(id);
      visit(category,depth,next);
      walkCategories(visit,id,depth + 1,next);
    }
  }
  function descendantIds(id) {
    const result = new Set([String(id)]);
    const walk = key => {
      for (const child of childrenOf(key)) {
        const childId = String(child.id);
        if (result.has(childId)) continue;
        result.add(childId);
        walk(childId);
      }
    };
    walk(id);
    return result;
  }
  function selectedCategoryKey() { return tree.getSelected()[0] || "all"; }
  function visiblePosts() {
    const selected = selectedCategoryKey();
    if (!taxonomyReady || selected === "all") return posts;
    if (selected === "uncategorized") return posts.filter(post => !assignmentMap.has(String(post.id)));
    if (!selected.startsWith("cat:")) return posts;
    const id = selected.slice(4);
    if (!categoryById(id)) return posts;
    const allowed = descendantIds(id);
    return posts.filter(post => allowed.has(String(assignmentMap.get(String(post.id)))));
  }
  function selectCategory(key) {
    tree.replaceSelected([key]);
    if (key.startsWith("cat:")) tree.expand(key);
    currentPage = 1;
    render();
  }
  function createEl(tag,className,text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function treeFilterButton(key,label,count) {
    const row = createEl("div","category-row");
    const spacer = createEl("span","category-expander"); spacer.setAttribute("aria-hidden","true");
    const button = createEl("button","category-link",label);
    button.type = "button";
    button.setAttribute("aria-current",String(tree.has(key)));
    button.addEventListener("click",() => selectCategory(key));
    row.append(spacer,button,createEl("span","category-count",count));
    return row;
  }
  function renderCategoryTree() {
    const target = elements["category-tree"];
    target.replaceChildren();
    target.appendChild(treeFilterButton("all","全部文章",posts.length));
    elements["new-category-button"].disabled = !taxonomyReady;
    if (!taxonomyReady) return;

    const unclassified = posts.filter(post => !assignmentMap.has(String(post.id))).length;
    if (unclassified || isAdmin()) target.appendChild(treeFilterButton("uncategorized","未分類",unclassified));
    if (!categories.length) {
      target.appendChild(createEl("p","category-empty","目前尚無分類。"));
      return;
    }

    const list = createEl("ul","category-list");
    const build = (parentId, seen = new Set()) => {
      const group = createEl("ul","category-list");
      for (const category of childrenOf(parentId)) {
        const id = String(category.id);
        if (seen.has(id)) continue;
        const next = new Set(seen); next.add(id);
        const children = childrenOf(id);
        const key = `cat:${id}`;
        const li = createEl("li","category-node");
        const row = createEl("div","category-row");
        const expander = createEl("button","category-expander",children.length ? (tree.isExpanded(key) ? "▾" : "▸") : "·");
        expander.type="button"; expander.disabled = children.length === 0;
        expander.setAttribute("aria-label",`${tree.isExpanded(key) ? "收合" : "展開"}「${category.name}」`);
        expander.setAttribute("aria-expanded",String(tree.isExpanded(key)));
        expander.addEventListener("click",() => { tree.toggleExpanded(key); renderCategoryTree(); });
        const label = createEl("button","category-link",category.name);
        label.type="button"; label.setAttribute("aria-current",String(tree.has(key)));
        label.addEventListener("click",() => selectCategory(key));
        const descendants = descendantIds(id);
        const count = posts.filter(post => descendants.has(String(assignmentMap.get(String(post.id))))).length;
        row.append(expander,label,createEl("span","category-count",count));
        if (isAdmin()) {
          const actions = createEl("span","category-node-actions");
          const add = createEl("button", "", "＋");
          add.type="button"; add.title=`在「${category.name}」下新增分類`;
          add.setAttribute("aria-label",add.title);
          add.addEventListener("click",() => openCategoryEditor(null,id));
          const edit = createEl("button", "", "編輯");
          edit.type="button"; edit.setAttribute("aria-label",`管理「${category.name}」`);
          edit.addEventListener("click",() => openCategoryEditor(category));
          actions.append(add,edit); row.append(actions);
        }
        li.appendChild(row);
        if (children.length) {
          const nested = build(id,next);
          nested.hidden = !tree.isExpanded(key);
          li.appendChild(nested);
        }
        group.appendChild(li);
      }
      return group;
    };
    const built = build(null);
    while (built.firstChild) list.appendChild(built.firstChild);
    target.appendChild(list);
  }

  function populateCategorySelect(select, { mode, currentId = null, selected = "" } = {}) {
    select.replaceChildren();
    const first = document.createElement("option");
    first.value = "";
    first.textContent = mode === "parent" ? "最上層" : "未分類";
    select.appendChild(first);
    const excluded = currentId === null ? new Set() : descendantIds(currentId);
    walkCategories((category,depth) => {
      const id = String(category.id);
      if (excluded.has(id)) return;
      const option = document.createElement("option");
      option.value = id;
      option.textContent = `${"　".repeat(Math.min(depth,12))}${category.name}`;
      select.appendChild(option);
    });
    select.value = selected === null ? "" : String(selected);
    if (select.selectedIndex < 0) select.value = "";
    select.disabled = !taxonomyReady;
    if (select === elements["post-category"]) postCategorySelect?.sync();
    if (select === elements["category-parent"]) categoryParentSelect?.sync();
  }

  function render() {
    renderCategoryTree();
    elements.posts.replaceChildren();
    const filtered = visiblePosts();
    elements.status.hidden = filtered.length > 0;
    if (!filtered.length) {
      elements.status.textContent = posts.length ? "這個分類目前還沒有文章。" : "目前還沒有文章。";
      elements.status.classList.remove("error");
    }
    const page = window.FictionPaginate?.paginate
      ? window.FictionPaginate.paginate(filtered, { page:currentPage, pageSize:5 })
      : { data:filtered, page:1, totalPages:1, hasPrevious:false, hasNext:false };
    currentPage = page.page;
    elements["post-count"].textContent = filtered.length ? `${page.page} / ${page.totalPages}` : "";
    elements["post-pages"].hidden = page.totalPages <= 1;
    elements["post-page-label"].textContent = `${page.page} / ${page.totalPages}`;
    elements["post-prev"].disabled = !page.hasPrevious;
    elements["post-next"].disabled = !page.hasNext;
    page.data.forEach(function (post) {
      const article = document.createElement("article"); article.className = "post-card";
      const meta = document.createElement("div"); meta.className = "post-meta";
      const time = document.createElement("time"); time.dateTime = post.created_at; time.textContent = formatDate(post.created_at); meta.append(time);
      if (!post.published) { const badge = document.createElement("span"); badge.className = "draft"; badge.textContent = "草稿"; meta.append(badge); }
      if (taxonomyReady) {
        const assigned = categoryById(assignmentMap.get(String(post.id)));
        if (assigned) meta.append(createEl("span","post-category-label",assigned.name));
      }
      const heading = document.createElement("div"); heading.className = "post-heading";
      const title = document.createElement("h3"); title.textContent = post.title;
      const toggle = document.createElement("button"); toggle.className = "post-toggle"; toggle.type = "button"; toggle.textContent = "›"; toggle.setAttribute("aria-label", `展開「${post.title}」內文`); toggle.setAttribute("aria-expanded", "false");
      const details = document.createElement("div"); details.className = "post-details";
      const content = document.createElement("div"); content.className = "post-content"; renderArticleContent(content, post.content);
      heading.append(title, toggle); details.append(meta, content); article.append(heading, details);
      toggle.addEventListener("click", function () {
        const open = article.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", `${open ? "收合" : "展開"}「${post.title}」內文`);
      });
      if (isAdmin()) {
        const actions = document.createElement("div"); actions.className = "post-actions";
        const edit = document.createElement("button"); edit.className = "button button-quiet"; edit.type = "button"; edit.textContent = "編輯"; edit.addEventListener("click", function () { openEditor(post); });
        const remove = document.createElement("button"); remove.className = "button button-quiet"; remove.type = "button"; remove.textContent = "刪除"; remove.addEventListener("click", function () { deletePost(post); });
        actions.append(edit, remove); details.append(actions);
      }
      elements.posts.append(article);
    });
  }

  async function loadPosts() {
    const version = ++loadVersion;
    const admin = isAdmin();
    elements.status.hidden = false;
    elements.status.textContent = "正在讀取文章…";
    elements.status.classList.remove("error");
    elements["category-status"].textContent = "正在讀取分類…";
    let nextPosts;
    try {
      if (admin) {
        const payload = await adminRequest("/posts");
        nextPosts = payload.posts || [];
      } else {
        const { data, error } = await db.from("posts").select("id,title,content,published,created_at,updated_at").eq("published",true).order("created_at",{ ascending:false });
        if (error) throw error;
        nextPosts = data || [];
      }
    } catch (error) {
      if (version !== loadVersion || admin !== isAdmin()) return;
      console.error("load posts failed",error);
      elements.status.hidden = false;
      elements.status.textContent = "暫時無法讀取文章，請稍後重新整理。";
      elements.status.classList.add("error");
      elements["category-status"].textContent = "";
      return;
    }
    if (version !== loadVersion || admin !== isAdmin()) return;
    posts = nextPosts;
    try {
      const { data:loadedCategories, error:categoryError } = await db.from("blog_categories")
        .select("id,parent_id,name,created_at,updated_at").order("id",{ ascending:true });
      if (categoryError) throw categoryError;
      let mappings;
      if (admin) {
        const payload = await taxonomyRequest("/assignments");
        mappings = payload.assignments || [];
      } else {
        const { data, error } = await db.from("blog_post_categories").select("post_id,category_id");
        if (error) throw error;
        mappings = data || [];
      }
      if (version !== loadVersion || admin !== isAdmin()) return;
      categories = loadedCategories || [];
      assignmentMap = new Map(mappings.map(item => [String(item.post_id),String(item.category_id)]));
      taxonomyReady = true;
      elements["category-status"].textContent = "";
      const selected = selectedCategoryKey();
      if (selected.startsWith("cat:") && !categoryById(selected.slice(4))) {
        tree.replaceSelected(["all"]);
        currentPage = 1;
      }
    } catch (error) {
      if (version !== loadVersion || admin !== isAdmin()) return;
      console.error("load taxonomy failed",error);
      categories = [];
      assignmentMap = new Map();
      taxonomyReady = false;
      tree.replaceSelected(["all"]);
      currentPage = 1;
      elements["category-status"].textContent = "分類暫時無法讀取，文章仍可正常閱讀。";
    }
    render();
  }

  function updateAuthUI() {
    const admin = isAdmin();
    if (lastAdminMode !== admin) {
      ++loadVersion; // Invalidates in-flight admin loads when switching to visitor mode.
      posts = []; categories = []; assignmentMap = new Map(); taxonomyReady = false;
      tree.replaceSelected(["all"]); tree.collapseAll();
      currentPage = 1;
      lastAdminMode = admin;
      elements.status.hidden = false;
      elements.status.textContent = "正在讀取文章…";
    }
    authUI.setState({ role:admin ? "admin" : "guest", permissions:admin ? ["write"] : [] });
    elements["auth-button"].textContent = admin ? "再會" : "歡迎";
    elements["new-category-button"].disabled = !taxonomyReady;
    renderCategoryTree();
  }

  function openEditor(post) {
    elements["editor-form"].reset(); elements["editor-error"].textContent = "";
    elements["post-id"].value = post?.id || "";
    elements["post-title"].value = post?.title || "";
    try { richEditor.load(post?.content || ""); }
    catch (error) { siteToast.show(message(error)); return; }
    elements["post-published"].checked = post ? post.published : true;
    const selectedTreeCategory = selectedCategoryKey();
    const initialCategory = post
      ? (assignmentMap.get(String(post.id)) || "")
      : (selectedTreeCategory.startsWith("cat:") ? selectedTreeCategory.slice(4) : "");
    populateCategorySelect(elements["post-category"], { mode:"post", selected:initialCategory });
    elements["editor-title"].textContent = post ? "編輯文章" : "新增文章";
    elements["editor-dialog"].showModal(); elements["post-title"].focus();
  }

  function openCategoryEditor(category = null, initialParentId = null) {
    if (!isAdmin() || !taxonomyReady) return;
    elements["category-form"].reset();
    elements["category-error"].textContent = "";
    elements["category-id"].value = category ? String(category.id) : "";
    elements["category-name"].value = category?.name || "";
    const parent = category ? categoryId(category.parent_id) : categoryId(initialParentId);
    populateCategorySelect(elements["category-parent"], {
      mode:"parent", currentId:category ? String(category.id) : null, selected:parent
    });
    elements["category-delete"].hidden = !category;
    elements["category-dialog-title"].textContent = category ? "管理分類" : "新增分類";
    elements["category-dialog"].showModal();
    elements["category-name"].focus();
  }

  async function deleteCategory() {
    if (!isAdmin() || !taxonomyReady) return;
    const id = elements["category-id"].value;
    const category = categoryById(id);
    if (!category) return;
    // Native dialog is in the top layer; close it before showing library Confirm.
    elements["category-dialog"].close();
    const confirmed = await window.SlowlyConfirm.show({
      title:"刪除分類", message:`確定刪除「${category.name}」？有文章或子分類時不會刪除。`,
      confirmText:"刪除",cancelText:"取消",className:"xiayian-confirm"
    });
    if (!confirmed) { elements["category-dialog"].showModal(); return; }
    try {
      await taxonomyRequest(`/categories/${encodeURIComponent(id)}`, { method:"DELETE" });
      await loadPosts();
      siteToast.show("分類已刪除。");
    } catch (error) {
      elements["category-dialog"].showModal();
      elements["category-error"].textContent = message(error);
    }
  }

  async function deletePost(post) {
    if (!window.SlowlyConfirm?.show) {
      siteToast.show("確認視窗尚未載入，未執行刪除。");
      return;
    }
    const confirmed = await window.SlowlyConfirm.show({
      title:"刪除文章", message:`確定要刪除「${post.title}」嗎？此操作無法復原。`,
      confirmText:"刪除",cancelText:"取消",className:"xiayian-confirm"
    });
    if (!confirmed) return;
    try { await adminRequest(`/posts/${encodeURIComponent(post.id)}`, { method:"DELETE" }); await loadPosts(); }
    catch (error) { siteToast.show(`刪除失敗：${message(error)}`); }
  }

  elements["auth-button"].addEventListener("click", async function () {
    if (isAdmin()) { await adminAuth.auth.signOut(); return; }
    elements["login-form"].reset(); authUI.setMessage(""); elements["login-dialog"].showModal(); elements["login-email"].focus();
  });
  elements["new-post-button"].addEventListener("click", function () { openEditor(null); });
  elements["new-category-button"].addEventListener("click", function () { openCategoryEditor(); });
  elements["category-delete"].addEventListener("click",deleteCategory);

  elements["category-form"].addEventListener("submit",async function(event) {
    event.preventDefault();
    if (!isAdmin() || !taxonomyReady) return;
    const name = elements["category-name"].value.trim();
    if (!name) { elements["category-error"].textContent = "請輸入分類名稱。"; return; }
    const id = elements["category-id"].value;
    const parent = elements["category-parent"].value || null;
    elements["category-error"].textContent = "";
    setBusy(elements["category-form"],true);
    try {
      const result = await taxonomyRequest(id ? `/categories/${encodeURIComponent(id)}` : "/categories", {
        method:id ? "PATCH" : "POST", body:{ name, parent_id:parent }
      });
      elements["category-dialog"].close();
      await loadPosts();
      if (parent) tree.expand(`cat:${parent}`);
      if (!id && result.category?.id) tree.replaceSelected([`cat:${result.category.id}`]);
      currentPage = 1;
      render();
      siteToast.show(id ? "分類已更新。" : "分類已新增。");
    } catch (error) { elements["category-error"].textContent = message(error); }
    finally { setBusy(elements["category-form"],false); categoryParentSelect?.sync(); }
  });

  elements["post-prev"].addEventListener("click", function () {
    if (currentPage <= 1) return;
    currentPage -= 1; render();
    elements.posts.scrollIntoView({ behavior:"smooth", block:"start" });
  });
  elements["post-next"].addEventListener("click", function () {
    currentPage += 1; render();
    elements.posts.scrollIntoView({ behavior:"smooth", block:"start" });
  });

  elements["editor-form"].addEventListener("submit", async function (event) {
    event.preventDefault();
    const title = elements["post-title"].value.trim();
    if (!title) { elements["editor-error"].textContent = "請輸入文章標題。"; return; }
    elements["editor-error"].textContent = "";
    let articleHTML;
    try { articleHTML = richEditor.getHTML(); }
    catch (error) { elements["editor-error"].textContent = message(error); return; }
    if (articleHTML === null) return;
    setBusy(elements["editor-form"], true); richEditor.setBusy(true);
    const values = { title, content:elements["post-content"].value, published:elements["post-published"].checked };
    const id = elements["post-id"].value;
    const targetCategory = taxonomyReady ? (elements["post-category"].value || null) : null;
    const initialCategory = id ? (assignmentMap.get(String(id)) || null) : null;
    try {
      // Original article API and payload unchanged. Category is saved separately.
      const saved = await adminRequest(id ? `/posts/${encodeURIComponent(id)}` : "/posts", {
        method:id ? "PATCH" : "POST", body:values
      });
      const savedId = saved.post?.id || id;
      if (savedId) elements["post-id"].value = String(savedId);
      if (taxonomyReady && savedId && targetCategory !== initialCategory) {
        try {
          await taxonomyRequest(`/assignments/${encodeURIComponent(savedId)}`, {
            method:"PUT", body:{ category_id:targetCategory }
          });
        } catch (error) {
          elements["editor-title"].textContent = "編輯文章";
          throw new Error(`文章已儲存，但分類尚未更新：${message(error)}。請重試。`);
        }
      }
      elements["editor-dialog"].close(); await loadPosts();
    } catch (error) { elements["editor-error"].textContent = `儲存失敗：${message(error)}`; }
    finally { setBusy(elements["editor-form"], false); richEditor.setBusy(false); postCategorySelect?.sync(); }
  });

  adminAuth.auth.onAuthStateChange(function (_event, currentSession) {
    session = currentSession?.user?.id && ADMIN_UIDS.has(currentSession.user.id) ? currentSession : null;
    updateAuthUI(); window.setTimeout(loadPosts, 0);
  });
  adminAuth.auth.getSession().then(async function (result) {
    const candidate = result.data.session;
    session = candidate?.user?.id && ADMIN_UIDS.has(candidate.user.id) ? candidate : null;
    if (candidate && !session) await adminAuth.auth.signOut();
    updateAuthUI(); await loadPosts();
  });
})();
