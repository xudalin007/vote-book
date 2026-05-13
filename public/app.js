const bookListElement = document.querySelector("#bookList");
const statusMessageElement = document.querySelector("#statusMessage");
const refreshButton = document.querySelector("#refreshButton");
const authSummaryText = document.querySelector("#authSummaryText");
const showLoginButton = document.querySelector("#showLoginButton");
const showRegisterButton = document.querySelector("#showRegisterButton");
const showChangePasswordButton = document.querySelector("#showChangePasswordButton");
const showAdminButton = document.querySelector("#showAdminButton");
const logoutButton = document.querySelector("#logoutButton");
const loginForm = document.querySelector("#loginForm");
const registerForm = document.querySelector("#registerForm");
const changePasswordForm = document.querySelector("#changePasswordForm");
const loginUsername = document.querySelector("#loginUsername");
const loginPassword = document.querySelector("#loginPassword");
const registerUsername = document.querySelector("#registerUsername");
const registerPassword = document.querySelector("#registerPassword");
const registerConfirmPassword = document.querySelector("#registerConfirmPassword");
const currentPassword = document.querySelector("#currentPassword");
const newPassword = document.querySelector("#newPassword");
const confirmNewPassword = document.querySelector("#confirmNewPassword");
const adminPanel = document.querySelector("#adminPanel");
const adminBookList = document.querySelector("#adminBookList");
const adminRefreshButton = document.querySelector("#adminRefreshButton");
const startVoteRoundButton = document.querySelector("#startVoteRoundButton");
const adminCreateBookForm = document.querySelector("#adminCreateBookForm");
const adminNewBookTitle = document.querySelector("#adminNewBookTitle");

let books = [];
let currentUser = null;
let currentVoteStats = {
  voteLimit: 3,
  usedVotes: 0,
  remainingVotes: 0
};

function setStatus(message, type = "default") {
  statusMessageElement.textContent = message;
  statusMessageElement.className = "status-message";

  if (type !== "default") {
    statusMessageElement.classList.add(type);
  }
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function createBookCard(book) {
  const card = document.createElement("article");
  card.className = "book-card";
  card.dataset.bookId = book.id;

  const coverWrap = document.createElement("div");
  coverWrap.className = "cover-wrap";

  const cover = document.createElement("img");
  cover.src = book.coverUrl;
  cover.alt = `${book.title} 封面`;
  cover.loading = "lazy";
  coverWrap.append(cover);

  const content = document.createElement("div");
  content.className = "book-content";

  const titleGroup = document.createElement("div");
  titleGroup.append(
    createTextElement("h3", "book-title", book.title),
    createTextElement("p", "book-author", book.author)
  );

  const description = createTextElement("p", "book-description", book.description);

  const footer = document.createElement("div");
  footer.className = "book-footer";

  const voteCount = document.createElement("div");
  voteCount.className = "vote-count";

  const voteNumber = createTextElement("strong", "vote-number", String(book.votes));
  const voteLabel = createTextElement("span", "", "当前票数");
  voteCount.append(voteNumber, voteLabel);

  const voteButton = document.createElement("button");
  voteButton.className = "vote-button";
  voteButton.type = "button";
  voteButton.dataset.bookId = book.id;

  if (!currentUser) {
    voteButton.textContent = "登录后投票";
  } else if (currentVoteStats.remainingVotes <= 0) {
    voteButton.textContent = "票数已用完";
    voteButton.disabled = true;
  } else {
    voteButton.textContent = "投票";
  }

  footer.append(voteCount, voteButton);
  content.append(titleGroup, description, footer);
  card.append(coverWrap, content);

  return card;
}

function renderBooks() {
  bookListElement.replaceChildren();

  if (books.length === 0) {
    bookListElement.append(createTextElement("div", "empty-state", "暂无图书数据"));
    return;
  }

  const fragment = document.createDocumentFragment();
  books.forEach((book) => {
    fragment.append(createBookCard(book));
  });
  bookListElement.append(fragment);
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options
  });
  const payload = await response.json();

  if (!response.ok || !payload.success) {
    const message = payload.error?.message || "请求失败";
    throw new Error(message);
  }

  return payload.data;
}

function setFormDisabled(form, disabled) {
  form.querySelectorAll("button, input").forEach((element) => {
    element.disabled = disabled;
  });
}

function hideAuthForms() {
  loginForm.hidden = true;
  registerForm.hidden = true;
  changePasswordForm.hidden = true;
}

function showAuthForm(type) {
  const showLogin = type === "login";
  const showRegister = type === "register";
  const showChangePassword = type === "changePassword";
  loginForm.hidden = !showLogin;
  registerForm.hidden = !showRegister;
  changePasswordForm.hidden = !showChangePassword;

  if (showLogin) {
    loginUsername.focus();
    return;
  }

  if (showRegister) {
    registerUsername.focus();
    return;
  }

  if (showChangePassword) {
    currentPassword.focus();
  }
}

function togglePasswordVisibility(button) {
  const input = document.querySelector(`#${button.dataset.togglePassword}`);

  if (!input) {
    return;
  }

  const shouldShowPassword = input.type === "password";
  input.type = shouldShowPassword ? "text" : "password";
  button.textContent = shouldShowPassword ? "隐藏" : "显示";
  button.setAttribute("aria-pressed", String(shouldShowPassword));
}

function renderAuthState() {
  const isLoggedIn = Boolean(currentUser);

  if (isLoggedIn) {
    const roleText = currentUser.role === "admin" ? "管理员" : "普通用户";
    authSummaryText.textContent = `当前用户：${currentUser.username}（${roleText}），剩余票数：${currentVoteStats.remainingVotes}/${currentVoteStats.voteLimit}`;
  } else {
    authSummaryText.textContent = "当前未登录，可以浏览图书；登录后才能投票。";
  }

  showLoginButton.hidden = isLoggedIn;
  showRegisterButton.hidden = isLoggedIn;
  showChangePasswordButton.hidden = !isLoggedIn;
  showAdminButton.hidden = !isLoggedIn || currentUser.role !== "admin";
  logoutButton.hidden = !isLoggedIn;

  if (isLoggedIn) {
    hideAuthForms();
  }

  if (!isLoggedIn || currentUser.role !== "admin") {
    adminPanel.hidden = true;
  }
}

async function loadCurrentUser() {
  try {
    const data = await requestJson("/api/auth/me");
    currentUser = data.authenticated ? data.user : null;
    currentVoteStats = {
      voteLimit: data.voteLimit ?? 3,
      usedVotes: data.usedVotes ?? 0,
      remainingVotes: data.remainingVotes ?? 0
    };
    renderAuthState();
    renderBooks();
  } catch (error) {
    currentUser = null;
    currentVoteStats = {
      voteLimit: 3,
      usedVotes: 0,
      remainingVotes: 0
    };
    renderAuthState();
    renderBooks();
    setStatus(error.message || "登录状态检查失败", "error");
  }
}

function validateAuthInput(username, password) {
  const normalizedUsername = username.trim();

  if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{2,32}$/.test(normalizedUsername)) {
    throw new Error("用户名需为 2-32 位中文、字母、数字、下划线或短横线");
  }

  validatePasswordInput(password);

  return normalizedUsername;
}

function validatePasswordInput(password) {
  if (password.length < 6 || password.length > 128) {
    throw new Error("密码长度需为 6-128 位");
  }
}

async function handleRegisterSubmit(event) {
  event.preventDefault();

  let username;

  try {
    username = validateAuthInput(registerUsername.value, registerPassword.value);

    if (registerPassword.value !== registerConfirmPassword.value) {
      throw new Error("两次输入的密码不一致");
    }
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }

  setFormDisabled(registerForm, true);
  setStatus("正在注册...");

  try {
    await requestJson("/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username,
        password: registerPassword.value
      })
    });

    registerForm.reset();
    loginUsername.value = username;
    loginPassword.value = "";
    showAuthForm("login");
    setStatus("注册成功，请登录", "success");
  } catch (error) {
    setStatus(error.message || "注册失败", "error");
  } finally {
    setFormDisabled(registerForm, false);
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();

  let username;

  try {
    username = validateAuthInput(loginUsername.value, loginPassword.value);
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }

  setFormDisabled(loginForm, true);
  setStatus("正在登录...");

  try {
    await requestJson("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username,
        password: loginPassword.value
      })
    });

    loginForm.reset();
    await loadCurrentUser();
    setStatus("登录成功", "success");
  } catch (error) {
    setStatus(error.message || "登录失败", "error");
  } finally {
    setFormDisabled(loginForm, false);
  }
}

async function handleLogout() {
  logoutButton.disabled = true;
  setStatus("正在退出登录...");

  try {
    await requestJson("/api/auth/logout", {
      method: "POST"
    });

    currentUser = null;
    currentVoteStats = {
      voteLimit: 3,
      usedVotes: 0,
      remainingVotes: 0
    };
    renderAuthState();
    renderBooks();
    setStatus("已退出登录", "success");
  } catch (error) {
    setStatus(error.message || "退出登录失败", "error");
  } finally {
    logoutButton.disabled = false;
  }
}

async function handleChangePasswordSubmit(event) {
  event.preventDefault();

  if (!currentUser) {
    setStatus("请先登录后再修改密码", "error");
    showAuthForm("login");
    return;
  }

  try {
    validatePasswordInput(currentPassword.value);
    validatePasswordInput(newPassword.value);

    if (newPassword.value !== confirmNewPassword.value) {
      throw new Error("两次输入的新密码不一致");
    }
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }

  setFormDisabled(changePasswordForm, true);
  setStatus("正在修改密码...");

  try {
    await requestJson("/api/auth/change-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value
      })
    });

    changePasswordForm.reset();
    hideAuthForms();
    setStatus("密码修改成功，请使用新密码登录", "success");
  } catch (error) {
    setStatus(error.message || "密码修改失败", "error");
  } finally {
    setFormDisabled(changePasswordForm, false);
  }
}

async function loadBooks() {
  refreshButton.disabled = true;
  setStatus("正在加载图书列表...");

  try {
    books = await requestJson("/api/books");
    renderBooks();
    setStatus("图书列表已更新", "success");
  } catch (error) {
    books = [];
    renderBooks();
    setStatus(error.message || "图书列表加载失败", "error");
  } finally {
    refreshButton.disabled = false;
  }
}

function updateBookVotes(bookId, votes) {
  books = books.map((book) => (
    book.id === bookId ? { ...book, votes } : book
  ));

  const card = bookListElement.querySelector(`[data-book-id="${bookId}"]`);
  const voteNumber = card?.querySelector(".vote-number");

  if (voteNumber) {
    voteNumber.textContent = String(votes);
  }
}

async function submitVote(bookId, button) {
  if (!currentUser) {
    setStatus("请先登录后再投票", "error");
    showAuthForm("login");
    return;
  }

  if (currentVoteStats.remainingVotes <= 0) {
    setStatus("每个用户最多可投 3 票", "error");
    renderBooks();
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "投票中...";
  setStatus("正在提交投票...");

  try {
    const result = await requestJson("/api/votes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ bookId })
    });

    updateBookVotes(result.bookId, result.votes);
    currentVoteStats = {
      ...currentVoteStats,
      usedVotes: result.userVoteCount,
      remainingVotes: result.remainingVotes
    };
    renderAuthState();
    renderBooks();
    setStatus("投票成功，票数已更新", "success");
  } catch (error) {
    if (error.message.includes("最多可投")) {
      currentVoteStats.remainingVotes = 0;
      renderAuthState();
      renderBooks();
    }

    setStatus(error.message || "投票失败，请稍后重试", "error");
  } finally {
    button.disabled = currentVoteStats.remainingVotes <= 0;
    button.textContent = originalText;
  }
}

function renderAdminBooks(adminBooks) {
  adminBookList.replaceChildren();

  if (adminBooks.length === 0) {
    adminBookList.append(createTextElement("div", "empty-state", "暂无图书数据"));
    return;
  }

  const fragment = document.createDocumentFragment();

  adminBooks.forEach((book) => {
    const row = document.createElement("article");
    row.className = "admin-book-row";
    row.dataset.bookId = book.id;

    const label = document.createElement("label");
    label.textContent = "书名";

    const input = document.createElement("input");
    input.type = "text";
    input.value = book.title;
    input.maxLength = 80;
    input.dataset.bookTitleInput = "true";
    label.append(input);

    const meta = createTextElement("p", "admin-book-meta", `ID：${book.id} · 当前票数：${book.votes}`);
    label.append(meta);

    const actions = document.createElement("div");
    actions.className = "admin-row-actions";

    const saveButton = document.createElement("button");
    saveButton.className = "secondary-button";
    saveButton.type = "button";
    saveButton.dataset.adminAction = "save";
    saveButton.textContent = "保存书名";

    const deleteButton = document.createElement("button");
    deleteButton.className = "secondary-button";
    deleteButton.type = "button";
    deleteButton.dataset.adminAction = "delete";
    deleteButton.textContent = "删除图书";

    actions.append(saveButton, deleteButton);
    row.append(label, actions);
    fragment.append(row);
  });

  adminBookList.append(fragment);
}

async function loadAdminBooks() {
  if (!currentUser || currentUser.role !== "admin") {
    setStatus("只有管理员可以访问后台", "error");
    return;
  }

  adminRefreshButton.disabled = true;
  setStatus("正在加载后台图书数据...");

  try {
    const adminBooks = await requestJson("/api/admin/books");
    renderAdminBooks(adminBooks);
    setStatus("后台图书数据已更新", "success");
  } catch (error) {
    setStatus(error.message || "后台图书数据加载失败", "error");
  } finally {
    adminRefreshButton.disabled = false;
  }
}

async function createAdminBook(event) {
  event.preventDefault();
  const title = adminNewBookTitle.value.trim();

  if (!title) {
    setStatus("请输入新图书书名", "error");
    return;
  }

  setFormDisabled(adminCreateBookForm, true);
  setStatus("正在新增图书...");

  try {
    await requestJson("/api/admin/books", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ title })
    });
    adminCreateBookForm.reset();
    await loadBooks();
    await loadAdminBooks();
    setStatus("图书已新增", "success");
  } catch (error) {
    setStatus(error.message || "新增图书失败", "error");
  } finally {
    setFormDisabled(adminCreateBookForm, false);
  }
}

async function updateAdminBookTitle(row) {
  const bookId = row.dataset.bookId;
  const input = row.querySelector("[data-book-title-input]");
  const title = input.value.trim();

  if (!title) {
    setStatus("书名不能为空", "error");
    return;
  }

  setStatus("正在保存书名...");

  try {
    await requestJson(`/api/admin/books/${encodeURIComponent(bookId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ title })
    });
    await loadBooks();
    await loadAdminBooks();
    setStatus("书名已更新", "success");
  } catch (error) {
    setStatus(error.message || "保存书名失败", "error");
  }
}

async function deleteAdminBook(row) {
  const bookId = row.dataset.bookId;
  const input = row.querySelector("[data-book-title-input]");
  const confirmed = window.confirm(`确定删除《${input.value}》吗？此操作会同步清理该书票数。`);

  if (!confirmed) {
    return;
  }

  setStatus("正在删除图书...");

  try {
    await requestJson(`/api/admin/books/${encodeURIComponent(bookId)}`, {
      method: "DELETE"
    });
    await loadBooks();
    await loadAdminBooks();
    await loadCurrentUser();
    setStatus("图书已删除", "success");
  } catch (error) {
    setStatus(error.message || "删除图书失败", "error");
  }
}

async function startNewVoteRound() {
  const confirmed = window.confirm("确定发起新一轮投票吗？这会清空所有当前票数和用户投票记录，每个用户将重新获得 3 票。");

  if (!confirmed) {
    return;
  }

  startVoteRoundButton.disabled = true;
  setStatus("正在发起新一轮投票...");

  try {
    await requestJson("/api/admin/vote-rounds", {
      method: "POST"
    });
    await loadBooks();
    await loadCurrentUser();

    if (!adminPanel.hidden) {
      await loadAdminBooks();
    }

    setStatus("新一轮投票已开始，所有票数已清零", "success");
  } catch (error) {
    setStatus(error.message || "发起新一轮投票失败", "error");
  } finally {
    startVoteRoundButton.disabled = false;
  }
}

bookListElement.addEventListener("click", (event) => {
  const button = event.target.closest(".vote-button");

  if (!button) {
    return;
  }

  submitVote(button.dataset.bookId, button);
});

refreshButton.addEventListener("click", loadBooks);
showLoginButton.addEventListener("click", () => showAuthForm("login"));
showRegisterButton.addEventListener("click", () => showAuthForm("register"));
showChangePasswordButton.addEventListener("click", () => showAuthForm("changePassword"));
showAdminButton.addEventListener("click", () => {
  adminPanel.hidden = !adminPanel.hidden;

  if (!adminPanel.hidden) {
    loadAdminBooks();
  }
});
logoutButton.addEventListener("click", handleLogout);
loginForm.addEventListener("submit", handleLoginSubmit);
registerForm.addEventListener("submit", handleRegisterSubmit);
changePasswordForm.addEventListener("submit", handleChangePasswordSubmit);
adminRefreshButton.addEventListener("click", loadAdminBooks);
startVoteRoundButton.addEventListener("click", startNewVoteRound);
adminCreateBookForm.addEventListener("submit", createAdminBook);

document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  button.addEventListener("click", () => togglePasswordVisibility(button));
});

adminBookList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-admin-action]");

  if (!button) {
    return;
  }

  const row = button.closest(".admin-book-row");

  if (button.dataset.adminAction === "save") {
    updateAdminBookTitle(row);
    return;
  }

  if (button.dataset.adminAction === "delete") {
    deleteAdminBook(row);
  }
});

document.querySelectorAll("[data-auth-cancel]").forEach((button) => {
  button.addEventListener("click", () => {
    hideAuthForms();
    setStatus("已取消认证操作");
  });
});

loadCurrentUser();
loadBooks();
