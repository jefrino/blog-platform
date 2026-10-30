const API = (window.API_BASE_URL || "").replace(/\/$/, "");
const $ = id => document.getElementById(id);
let token = localStorage.getItem("blog_token") || "";
let currentUser = null;
let authMode = "login";
let editingPostId = null;
let activePostId = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function dateText(value) {
  return new Date(value).toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
}
function excerpt(text) { return text.length > 175 ? text.slice(0,175).trim() + "…" : text; }
function showNotice(message, error=false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
  $("notice").classList.remove("hidden");
  window.scrollTo({top: $("feedSection").offsetTop - 80, behavior:"smooth"});
}
function hideModal(id) { $(id).classList.add("hidden"); }
function showModal(id) { $(id).classList.remove("hidden"); }

async function api(path, options={}) {
  const headers = { "Content-Type":"application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${API}${path}`, { ...options, headers });
  } catch {
    throw new Error("Cannot reach the backend. Check your API URL and make sure the backend is deployed and running.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token) {
      token = ""; currentUser = null; localStorage.removeItem("blog_token"); updateHeader();
    }
    throw new Error(data.error || "Request failed.");
  }
  return data;
}
function updateHeader() {
  const loggedIn = Boolean(currentUser);
  $("loginBtn").classList.toggle("hidden", loggedIn);
  $("registerBtn").classList.toggle("hidden", loggedIn);
  $("userMenu").classList.toggle("hidden", !loggedIn);
  $("newPostBtn").classList.toggle("hidden", !loggedIn);
  $("welcomeUser").textContent = loggedIn ? `Hi, ${currentUser.username}` : "";
  $("heroWriteBtn").textContent = loggedIn ? "Write a story ↗" : "Join the conversation ↗";
}
async function loadMe() {
  if (!token) { updateHeader(); return; }
  try { const data = await api("/api/auth/me"); currentUser = data.user; }
  catch { token = ""; currentUser = null; localStorage.removeItem("blog_token"); }
  updateHeader();
}
async function loadPosts() {
  $("posts").innerHTML = '<div class="loading-state">Gathering the latest stories…</div>';
  try {
    const data = await api("/api/posts");
    $("postCount").textContent = `${data.posts.length} ${data.posts.length === 1 ? "story" : "stories"}`;
    if (!data.posts.length) {
      $("posts").innerHTML = '<div class="empty-state"><h3>No stories yet.</h3><p>Be the first to share an idea with the community.</p></div>';
      return;
    }
    $("posts").innerHTML = data.posts.map(post => `
      <article class="post-card" data-post="${post.id}" tabindex="0" role="button" aria-label="Read ${escapeHtml(post.title)}">
        <div class="post-meta"><span>BY ${escapeHtml(post.author.toUpperCase())}</span><span>·</span><span>${dateText(post.created_at)}</span></div>
        <h3>${escapeHtml(post.title)}</h3>
        <p class="post-excerpt">${escapeHtml(excerpt(post.content))}</p>
        <div class="post-bottom"><span class="post-meta">${post.comment_count} comments</span><span class="read-more">READ STORY ↗</span></div>
      </article>`).join("");
    document.querySelectorAll("[data-post]").forEach(card => {
      card.addEventListener("click", () => openPost(card.dataset.post));
      card.addEventListener("keydown", e => { if (e.key === "Enter") openPost(card.dataset.post); });
    });
  } catch (err) {
    $("postCount").textContent = "Unable to load";
    $("posts").innerHTML = `<div class="empty-state">${escapeHtml(err.message)}<br><br>Check that the backend is running and frontend/config.js has the correct API URL.</div>`;
  }
}
function openAuth(mode) {
  authMode = mode;
  const registering = mode === "register";
  $("authTitle").textContent = registering ? "Join the community." : "Welcome back.";
  $("authSubtitle").textContent = registering ? "Create an account and share your perspective." : "Log in to join the conversation.";
  $("usernameLabel").classList.toggle("hidden", !registering);
  $("authUsername").required = registering;
  $("authPassword").autocomplete = registering ? "new-password" : "current-password";
  $("authSubmit").textContent = registering ? "Create account" : "Log in";
  $("authSwitch").innerHTML = registering
    ? 'Already a member? <button id="switchAuthBtn" type="button">Log in</button>'
    : 'New here? <button id="switchAuthBtn" type="button">Create an account</button>';
  $("switchAuthBtn").addEventListener("click", () => openAuth(registering ? "login" : "register"));
  $("authError").textContent = "";
  $("authForm").reset();
  showModal("authModal");
}
$("authForm").addEventListener("submit", async e => {
  e.preventDefault(); $("authError").textContent = "";
  const body = { email:$("authEmail").value, password:$("authPassword").value };
  if (authMode === "register") body.username = $("authUsername").value;
  $("authSubmit").disabled = true;
  try {
    const data = await api(`/api/auth/${authMode === "register" ? "register" : "login"}`, { method:"POST", body:JSON.stringify(body) });
    token = data.token; currentUser = data.user; localStorage.setItem("blog_token", token);
    updateHeader(); hideModal("authModal"); await loadPosts(); showNotice(`Welcome, ${currentUser.username}!`);
  } catch (err) { $("authError").textContent = err.message; }
  finally { $("authSubmit").disabled = false; }
});
function openEditor(post=null) {
  if (!currentUser) return openAuth("login");
  editingPostId = post ? post.id : null;
  $("editorTitle").textContent = post ? "Edit your story." : "Write a story.";
  $("publishBtn").textContent = post ? "Save changes ↗" : "Publish story ↗";
  $("postTitle").value = post?.title || "";
  $("postContent").value = post?.content || "";
  $("postError").textContent = "";
  showModal("editorModal");
}
$("postForm").addEventListener("submit", async e => {
  e.preventDefault(); $("postError").textContent = "";
  const body = { title:$("postTitle").value, content:$("postContent").value };
  $("publishBtn").disabled = true;
  try {
    await api(editingPostId ? `/api/posts/${editingPostId}` : "/api/posts", {
      method:editingPostId ? "PUT" : "POST", body:JSON.stringify(body)
    });
    hideModal("editorModal"); await loadPosts(); showNotice(editingPostId ? "Your story has been updated." : "Your story is now published.");
  } catch (err) { $("postError").textContent = err.message; }
  finally { $("publishBtn").disabled = false; }
});
async function deletePost(id) {
  if (!confirm("Delete this post? This will also delete its comments.")) return;
  try { await api(`/api/posts/${id}`, {method:"DELETE"}); hideModal("detailModal"); await loadPosts(); showNotice("Post deleted."); }
  catch (err) { alert(err.message); }
}
async function openPost(id) {
  activePostId = id;
  showModal("detailModal");
  $("detailContent").innerHTML = '<p class="loading-state">Opening story…</p>';
  try {
    const {post, comments} = await api(`/api/posts/${id}`);
    const ownPost = currentUser && currentUser.id === post.author_id;
    $("detailContent").innerHTML = `
      <div class="post-meta">BY ${escapeHtml(post.author.toUpperCase())} <span>·</span> ${dateText(post.created_at)}</div>
      <h1 class="detail-title" id="detailTitle">${escapeHtml(post.title)}</h1>
      <div class="detail-body">${escapeHtml(post.content)}</div>
      ${ownPost ? `<div class="detail-actions"><button class="btn btn-outline" id="editPostBtn">Edit story</button><button class="btn btn-outline" id="deletePostBtn">Delete</button></div>` : ""}
      <div class="comments-heading">Conversation (${comments.length})</div>
      <div id="commentsList">${comments.length ? comments.map(comment => `
        <div class="comment"><div class="comment-meta"><span><b>${escapeHtml(comment.author)}</b> · ${dateText(comment.created_at)}</span>
        ${currentUser && currentUser.id === comment.author_id ? `<button class="nav-link" data-delete-comment="${comment.id}">Delete</button>` : ""}</div>
        <p>${escapeHtml(comment.content)}</p></div>`).join("") : '<p class="post-meta">No comments yet. Start the conversation.</p>'}</div>
      ${currentUser ? `<form class="comment-form" id="commentForm"><label>Leave a comment<textarea id="commentText" maxlength="1200" required placeholder="Add something thoughtful…"></textarea></label><p class="form-error" id="commentError"></p><button class="btn btn-dark" type="submit">Post comment ↗</button></form>` : '<p class="post-meta">Log in to leave a comment.</p><button class="btn btn-outline" id="commentLoginBtn">Log in to comment</button>'}`;
    if (ownPost) {
      $("editPostBtn").addEventListener("click", () => { hideModal("detailModal"); openEditor(post); });
      $("deletePostBtn").addEventListener("click", () => deletePost(post.id));
    }
    if (!currentUser) $("commentLoginBtn").addEventListener("click", () => { hideModal("detailModal"); openAuth("login"); });
    if (currentUser) $("commentForm").addEventListener("submit", submitComment);
    document.querySelectorAll("[data-delete-comment]").forEach(btn => btn.addEventListener("click", () => deleteComment(btn.dataset.deleteComment)));
  } catch (err) { $("detailContent").innerHTML = `<p>${escapeHtml(err.message)}</p>`; }
}
async function submitComment(e) {
  e.preventDefault(); $("commentError").textContent = "";
  try {
    await api(`/api/posts/${activePostId}/comments`, {method:"POST",body:JSON.stringify({content:$("commentText").value})});
    await openPost(activePostId); await loadPosts();
  } catch (err) { $("commentError").textContent = err.message; }
}
async function deleteComment(id) {
  if (!confirm("Delete this comment?")) return;
  try { await api(`/api/comments/${id}`, {method:"DELETE"}); await openPost(activePostId); await loadPosts(); }
  catch (err) { alert(err.message); }
}

$("loginBtn").addEventListener("click", () => openAuth("login"));
$("registerBtn").addEventListener("click", () => openAuth("register"));
$("heroWriteBtn").addEventListener("click", () => currentUser ? openEditor() : openAuth("register"));
$("newPostBtn").addEventListener("click", () => openEditor());
$("logoutBtn").addEventListener("click", () => {
  token = ""; currentUser = null; localStorage.removeItem("blog_token"); updateHeader(); loadPosts(); showNotice("You have been logged out.");
});
$("homeBtn").addEventListener("click", () => window.scrollTo({top:0,behavior:"smooth"}));
document.querySelectorAll("[data-close]").forEach(btn => btn.addEventListener("click", () => hideModal(btn.dataset.close)));
document.querySelectorAll(".modal-backdrop").forEach(backdrop => backdrop.addEventListener("click", e => {
  if (e.target === backdrop) hideModal(backdrop.id);
}));
document.addEventListener("keydown", e => {
  if (e.key === "Escape") document.querySelectorAll(".modal-backdrop").forEach(m => hideModal(m.id));
});

(async function init() { await loadMe(); await loadPosts(); })();
