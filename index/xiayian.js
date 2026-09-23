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
  const elements = Object.fromEntries(["posts","status","post-count","auth-button","new-post-button","admin-badge","login-dialog","login-form","login-email","login-password","login-error","editor-dialog","editor-form","editor-title","editor-error","post-id","post-title","post-content","post-published"].map(function (id) { return [id, document.getElementById(id)]; }));
  let session = null;
  let posts = [];

  function isAdmin() { return Boolean(session?.user?.id && ADMIN_UIDS.has(session.user.id)); }
  function formatDate(value) { return new Intl.DateTimeFormat("zh-TW", { year:"numeric", month:"long", day:"numeric" }).format(new Date(value)); }
  function setBusy(form, busy) { form.querySelectorAll("button,input,textarea").forEach(function (node) { node.disabled = busy; }); }
  function message(error) { return error?.message || "發生未預期的錯誤，請稍後再試。"; }

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

  function render() {
    elements.posts.replaceChildren();
    elements.status.hidden = posts.length > 0;
    if (!posts.length) { elements.status.textContent = "目前還沒有文章。"; elements.status.classList.remove("error"); }
    elements["post-count"].textContent = posts.length ? `1 / ${Math.max(1, Math.ceil(posts.length / 5))}` : "";
    posts.forEach(function (post) {
      const article = document.createElement("article"); article.className = "post-card";
      const meta = document.createElement("div"); meta.className = "post-meta";
      const time = document.createElement("time"); time.dateTime = post.created_at; time.textContent = formatDate(post.created_at); meta.append(time);
      if (!post.published) { const badge = document.createElement("span"); badge.className = "draft"; badge.textContent = "草稿"; meta.append(badge); }
      const heading = document.createElement("div"); heading.className = "post-heading";
      const title = document.createElement("h3"); title.textContent = post.title;
      const toggle = document.createElement("button"); toggle.className = "post-toggle"; toggle.type = "button"; toggle.textContent = "›"; toggle.setAttribute("aria-label", `展開「${post.title}」內文`); toggle.setAttribute("aria-expanded", "false");
      const details = document.createElement("div"); details.className = "post-details";
      const content = document.createElement("div"); content.className = "post-content"; content.textContent = post.content;
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
    elements.status.hidden = false; elements.status.textContent = "正在讀取文章…"; elements.status.classList.remove("error");
    try {
      if (isAdmin()) {
        const payload = await adminRequest("/posts");
        posts = payload.posts || [];
      } else {
        const { data, error } = await db.from("posts").select("id,title,content,published,created_at,updated_at").eq("published", true).order("created_at", { ascending:false });
        if (error) throw error;
        posts = data || [];
      }
      render();
    } catch (error) {
      console.error("load posts failed", error);
      elements.status.textContent = "暫時無法讀取文章，請稍後重新整理。"; elements.status.classList.add("error");
    }
  }

  function updateAuthUI() {
    const admin = isAdmin();
    elements["new-post-button"].hidden = !admin; elements["admin-badge"].hidden = !admin;
    elements["auth-button"].textContent = admin ? "再會" : "歡迎";
    render();
  }

  function openEditor(post) {
    elements["editor-form"].reset(); elements["editor-error"].textContent = "";
    elements["post-id"].value = post?.id || ""; elements["post-title"].value = post?.title || ""; elements["post-content"].value = post?.content || ""; elements["post-published"].checked = post ? post.published : true;
    elements["editor-title"].textContent = post ? "編輯文章" : "新增文章"; elements["editor-dialog"].showModal(); elements["post-title"].focus();
  }

  async function deletePost(post) {
    if (!confirm(`確定要刪除「${post.title}」嗎？此操作無法復原。`)) return;
    try { await adminRequest(`/posts/${encodeURIComponent(post.id)}`, { method:"DELETE" }); await loadPosts(); }
    catch (error) { alert(`刪除失敗：${message(error)}`); }
  }

  elements["auth-button"].addEventListener("click", async function () {
    if (isAdmin()) { await adminAuth.auth.signOut(); return; }
    elements["login-form"].reset(); elements["login-error"].textContent = ""; elements["login-dialog"].showModal(); elements["login-email"].focus();
  });
  elements["new-post-button"].addEventListener("click", function () { openEditor(null); });

  elements["login-form"].addEventListener("submit", async function (event) {
    event.preventDefault(); setBusy(elements["login-form"], true); elements["login-error"].textContent = "";
    const { data, error } = await adminAuth.auth.signInWithPassword({ email:elements["login-email"].value.trim(), password:elements["login-password"].value });
    setBusy(elements["login-form"], false);
    if (error) { elements["login-error"].textContent = "登入失敗，請確認帳號與密碼。"; return; }
    if (!data.user?.id || !ADMIN_UIDS.has(data.user.id)) { await adminAuth.auth.signOut(); elements["login-error"].textContent = "此帳號沒有最高管理權限。"; return; }
    elements["login-dialog"].close();
  });

  elements["editor-form"].addEventListener("submit", async function (event) {
    event.preventDefault(); const title = elements["post-title"].value.trim();
    if (!title) { elements["editor-error"].textContent = "請輸入文章標題。"; return; }
    setBusy(elements["editor-form"], true); elements["editor-error"].textContent = "";
    const values = { title, content:elements["post-content"].value, published:elements["post-published"].checked };
    const id = elements["post-id"].value;
    try {
      await adminRequest(id ? `/posts/${encodeURIComponent(id)}` : "/posts", { method:id ? "PATCH" : "POST", body:values });
      elements["editor-dialog"].close(); await loadPosts();
    } catch (error) { elements["editor-error"].textContent = `儲存失敗：${message(error)}`; }
    finally { setBusy(elements["editor-form"], false); }
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
