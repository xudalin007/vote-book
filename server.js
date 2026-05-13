const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { promises: fs } = require("node:fs");

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const BOOK_FILE = path.join(ROOT_DIR, "book.json");
const VOTE_FILE = path.join(ROOT_DIR, "vote.json");
const USER_FILE = path.join(ROOT_DIR, "user.json");
const MAX_BODY_SIZE = 1024 * 1024;
const SESSION_COOKIE_NAME = "book_vote_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const VOTE_LIMIT = 3;
const DEFAULT_BOOK_COVER_URL = "/covers/default.svg";
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
};

const scrypt = promisify(crypto.scrypt);

const DEFAULT_BOOKS = [
  {
    id: "book-001",
    title: "深入浅出 Node.js",
    author: "朴灵",
    description: "介绍 Node.js 运行机制、异步编程和服务端开发实践。",
    coverUrl: "/covers/book-001.svg"
  },
  {
    id: "book-002",
    title: "JavaScript 高级程序设计",
    author: "Nicholas C. Zakas",
    description: "系统讲解 JavaScript 语言特性和浏览器端开发基础。",
    coverUrl: "/covers/book-002.svg"
  },
  {
    id: "book-003",
    title: "代码整洁之道",
    author: "Robert C. Martin",
    description: "围绕命名、函数、类和测试讲解可维护代码实践。",
    coverUrl: "/covers/book-003.svg"
  },
  {
    id: "book-004",
    title: "重构",
    author: "Martin Fowler",
    description: "介绍识别代码坏味道并通过小步改造改善设计的方法。",
    coverUrl: "/covers/book-004.svg"
  },
  {
    id: "book-005",
    title: "设计模式",
    author: "Erich Gamma 等",
    description: "总结常见面向对象设计模式及其适用场景。",
    coverUrl: "/covers/book-005.svg"
  },
  {
    id: "book-006",
    title: "程序员修炼之道",
    author: "Andrew Hunt / David Thomas",
    description: "从工程习惯、工具使用和职业实践角度提升开发质量。",
    coverUrl: "/covers/book-006.svg"
  }
];

let dataWriteQueue = Promise.resolve();
let userWriteQueue = Promise.resolve();
const sessions = new Map();

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function sendSuccess(response, data, statusCode = 200, headers = {}) {
  sendJson(response, statusCode, {
    success: true,
    data
  }, headers);
}

function sendError(response, statusCode, code, message, headers = {}) {
  sendJson(response, statusCode, {
    success: false,
    error: {
      code,
      message
    }
  }, headers);
}

function createCodedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
}

async function writeJsonFile(filePath, data) {
  const tempFile = `${filePath}.tmp`;
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tempFile, content, "utf8");
  await fs.rename(tempFile, filePath);
}

function createDefaultBookVotes(books) {
  return books.reduce((bookVotes, book) => {
    bookVotes[book.id] = 0;
    return bookVotes;
  }, {});
}

function createDefaultVoteData(books) {
  return {
    bookVotes: createDefaultBookVotes(books),
    userVotes: {}
  };
}

function assertValidBooks(books) {
  if (!Array.isArray(books)) {
    throw new Error("book.json must be an array");
  }

  for (const book of books) {
    if (
      !book ||
      typeof book.id !== "string" ||
      typeof book.title !== "string" ||
      typeof book.author !== "string" ||
      typeof book.description !== "string" ||
      typeof book.coverUrl !== "string"
    ) {
      throw new Error("book.json contains invalid book item");
    }
  }
}

function assertValidVoteData(voteData) {
  if (!voteData || Array.isArray(voteData) || typeof voteData !== "object") {
    throw new Error("vote.json must be an object");
  }

  if (!voteData.bookVotes || Array.isArray(voteData.bookVotes) || typeof voteData.bookVotes !== "object") {
    throw new Error("vote.json bookVotes must be an object");
  }

  if (!voteData.userVotes || Array.isArray(voteData.userVotes) || typeof voteData.userVotes !== "object") {
    throw new Error("vote.json userVotes must be an object");
  }

  for (const [bookId, voteCount] of Object.entries(voteData.bookVotes)) {
    if (typeof bookId !== "string" || !Number.isInteger(voteCount) || voteCount < 0) {
      throw new Error("vote.json contains invalid vote count");
    }
  }

  for (const [userId, records] of Object.entries(voteData.userVotes)) {
    if (typeof userId !== "string" || !Array.isArray(records)) {
      throw new Error("vote.json contains invalid user vote records");
    }

    for (const record of records) {
      if (
        !record ||
        typeof record.bookId !== "string" ||
        typeof record.votedAt !== "string"
      ) {
        throw new Error("vote.json contains invalid user vote record");
      }
    }
  }
}

function normalizeVoteData(votes, books) {
  if (!votes || Array.isArray(votes) || typeof votes !== "object") {
    throw new Error("vote.json must be an object");
  }

  if ("bookVotes" in votes || "userVotes" in votes) {
    const voteData = {
      bookVotes: {
        ...createDefaultBookVotes(books),
        ...(votes.bookVotes || {})
      },
      userVotes: votes.userVotes || {}
    };
    assertValidVoteData(voteData);
    return voteData;
  }

  const voteData = {
    bookVotes: {
      ...createDefaultBookVotes(books),
      ...votes
    },
    userVotes: {}
  };
  assertValidVoteData(voteData);
  return voteData;
}

function getUserVoteStats(userId, voteData) {
  const usedVotes = userId && voteData.userVotes[userId]
    ? voteData.userVotes[userId].length
    : 0;

  return {
    voteLimit: VOTE_LIMIT,
    usedVotes,
    remainingVotes: Math.max(VOTE_LIMIT - usedVotes, 0)
  };
}

function enqueueDataWrite(task) {
  const writeTask = dataWriteQueue.then(task);
  dataWriteQueue = writeTask.catch(() => {});
  return writeTask;
}

function validateBookTitle(title) {
  const normalizedTitle = typeof title === "string" ? title.trim() : "";

  if (normalizedTitle.length < 1 || normalizedTitle.length > 80) {
    throw createCodedError("INVALID_BOOK_TITLE", "书名长度需为 1-80 个字符");
  }

  return normalizedTitle;
}

function generateBookId(books) {
  const maxNumber = books.reduce((maxValue, book) => {
    const match = /^book-(\d+)$/.exec(book.id);
    return match ? Math.max(maxValue, Number(match[1])) : maxValue;
  }, 0);

  return `book-${String(maxNumber + 1).padStart(3, "0")}`;
}

function requireAuthenticatedUser(request, response) {
  const user = getCurrentUser(request);

  if (!user) {
    sendError(response, 401, "UNAUTHORIZED", "请先登录");
    return null;
  }

  return user;
}

function requireAdminUser(request, response) {
  const user = requireAuthenticatedUser(request, response);

  if (!user) {
    return null;
  }

  if (user.role !== "admin") {
    sendError(response, 403, "FORBIDDEN", "没有管理员权限");
    return null;
  }

  return user;
}

function assertValidUsers(users) {
  if (!Array.isArray(users)) {
    throw new Error("user.json must be an array");
  }

  for (const user of users) {
    if (
      !user ||
      typeof user.id !== "string" ||
      typeof user.username !== "string" ||
      !["user", "admin"].includes(user.role) ||
      typeof user.passwordHash !== "string" ||
      typeof user.passwordSalt !== "string" ||
      typeof user.createdAt !== "string"
    ) {
      throw new Error("user.json contains invalid user item");
    }
  }
}

function normalizeUsers(users) {
  if (!Array.isArray(users)) {
    throw new Error("user.json must be an array");
  }

  return users.map((user) => ({
    ...user,
    role: user.role === "admin" ? "admin" : "user"
  }));
}

async function ensureDataFiles() {
  if (!(await fileExists(BOOK_FILE))) {
    await writeJsonFile(BOOK_FILE, DEFAULT_BOOKS);
  }

  const books = await readJsonFile(BOOK_FILE);
  assertValidBooks(books);

  if (!(await fileExists(VOTE_FILE))) {
    await writeJsonFile(VOTE_FILE, createDefaultVoteData(books));
  }

  const votes = await readJsonFile(VOTE_FILE);
  const normalizedVoteData = normalizeVoteData(votes, books);
  if (JSON.stringify(votes) !== JSON.stringify(normalizedVoteData)) {
    await writeJsonFile(VOTE_FILE, normalizedVoteData);
  }

  if (!(await fileExists(USER_FILE))) {
    await writeJsonFile(USER_FILE, []);
  }

  const users = await readJsonFile(USER_FILE);
  const normalizedUsers = normalizeUsers(users);
  assertValidUsers(normalizedUsers);
  if (JSON.stringify(users) !== JSON.stringify(normalizedUsers)) {
    await writeJsonFile(USER_FILE, normalizedUsers);
  }
}

async function loadBooksWithVotes() {
  const [books, votes] = await Promise.all([
    readJsonFile(BOOK_FILE),
    readJsonFile(VOTE_FILE)
  ]);

  assertValidBooks(books);
  const voteData = normalizeVoteData(votes, books);

  return books.map((book) => ({
    ...book,
    votes: voteData.bookVotes[book.id] || 0
  }));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;

      if (body.length > MAX_BODY_SIZE) {
        reject(new Error("REQUEST_BODY_TOO_LARGE"));
        request.destroy();
      }
    });

    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("INVALID_JSON_BODY"));
      }
    });

    request.on("error", reject);
  });
}

function normalizeUsername(username) {
  return typeof username === "string" ? username.trim() : "";
}

function validateUsername(username) {
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{2,32}$/.test(username)) {
    throw createCodedError("INVALID_USERNAME", "用户名需为 2-32 位中文、字母、数字、下划线或短横线");
  }
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 6 || password.length > 128) {
    throw createCodedError("INVALID_PASSWORD", "密码长度需为 6-128 位");
  }
}

function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role || "user"
  };
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("base64")) {
  const derivedKey = await scrypt(password, salt, PASSWORD_KEY_LENGTH, PASSWORD_SCRYPT_OPTIONS);

  return {
    passwordSalt: salt,
    passwordHash: derivedKey.toString("base64")
  };
}

async function verifyPassword(password, user) {
  const { passwordHash } = await hashPassword(password, user.passwordSalt);
  const expectedHash = Buffer.from(user.passwordHash, "base64");
  const actualHash = Buffer.from(passwordHash, "base64");

  if (expectedHash.length !== actualHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedHash, actualHash);
}

function createSession(user) {
  const sessionId = crypto.randomBytes(32).toString("hex");
  sessions.set(sessionId, {
    userId: user.id,
    username: user.username,
    role: user.role || "user",
    createdAt: new Date().toISOString()
  });
  return sessionId;
}

function createSessionCookie(sessionId) {
  return `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

function createClearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function parseCookies(request) {
  const cookieHeader = request.headers.cookie;

  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(";").reduce((cookies, item) => {
    const separatorIndex = item.indexOf("=");

    if (separatorIndex === -1) {
      return cookies;
    }

    const name = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();
    cookies[name] = value;
    return cookies;
  }, {});
}

function getSessionId(request) {
  const cookies = parseCookies(request);
  const sessionId = cookies[SESSION_COOKIE_NAME];

  if (!sessionId || !/^[a-f0-9]{64}$/.test(sessionId)) {
    return "";
  }

  return sessionId;
}

function getCurrentUser(request) {
  const sessionId = getSessionId(request);
  const session = sessions.get(sessionId);

  if (!session) {
    return null;
  }

  return {
    id: session.userId,
    username: session.username,
    role: session.role || "user"
  };
}

async function createUser(username, password, role = "user") {
  const writeTask = userWriteQueue.then(async () => {
    const users = await readJsonFile(USER_FILE);
    const normalizedUsers = normalizeUsers(users);
    assertValidUsers(normalizedUsers);

    const usernameExists = normalizedUsers.some((user) => (
      user.username.toLowerCase() === username.toLowerCase()
    ));

    if (usernameExists) {
      throw createCodedError("USERNAME_EXISTS", "用户名已存在");
    }

    const passwordData = await hashPassword(password);
    const user = {
      id: `user-${crypto.randomBytes(8).toString("hex")}`,
      username,
      role,
      passwordHash: passwordData.passwordHash,
      passwordSalt: passwordData.passwordSalt,
      createdAt: new Date().toISOString()
    };

    await writeJsonFile(USER_FILE, [...normalizedUsers, user]);
    return toPublicUser(user);
  });

  userWriteQueue = writeTask.catch(() => {});
  return writeTask;
}

async function changeUserPassword(userId, currentPassword, newPassword) {
  const writeTask = userWriteQueue.then(async () => {
    const users = await readJsonFile(USER_FILE);
    const normalizedUsers = normalizeUsers(users);
    assertValidUsers(normalizedUsers);
    const userIndex = normalizedUsers.findIndex((user) => user.id === userId);

    if (userIndex === -1) {
      throw createCodedError("USER_NOT_FOUND", "用户不存在");
    }

    const user = normalizedUsers[userIndex];
    const isCurrentPasswordValid = await verifyPassword(currentPassword, user);

    if (!isCurrentPasswordValid) {
      throw createCodedError("INVALID_CURRENT_PASSWORD", "当前密码错误");
    }

    const passwordData = await hashPassword(newPassword);
    const nextUsers = normalizedUsers.map((item) => (
      item.id === userId
        ? {
          ...item,
          passwordHash: passwordData.passwordHash,
          passwordSalt: passwordData.passwordSalt
        }
        : item
    ));

    await writeJsonFile(USER_FILE, nextUsers);

    return {
      passwordChanged: true
    };
  });

  userWriteQueue = writeTask.catch(() => {});
  return writeTask;
}

async function handleGetBooks(response) {
  try {
    const books = await loadBooksWithVotes();
    sendSuccess(response, books);
  } catch (error) {
    console.error("Failed to load books:", error);
    sendError(response, 500, "DATA_READ_ERROR", "图书数据读取失败");
  }
}

async function addVote(bookId, user) {
  return enqueueDataWrite(async () => {
    const books = await readJsonFile(BOOK_FILE);
    assertValidBooks(books);

    const bookExists = books.some((book) => book.id === bookId);
    if (!bookExists) {
      throw createCodedError("BOOK_NOT_FOUND", "图书不存在");
    }

    const votes = await readJsonFile(VOTE_FILE);
    const voteData = normalizeVoteData(votes, books);
    const currentRecords = voteData.userVotes[user.id] || [];

    if (currentRecords.length >= VOTE_LIMIT) {
      throw createCodedError("VOTE_LIMIT_REACHED", "每个用户最多可投 3 票");
    }

    const nextRecords = [
      ...currentRecords,
      {
        bookId,
        votedAt: new Date().toISOString()
      }
    ];

    const nextVoteData = {
      bookVotes: {
        ...voteData.bookVotes,
        [bookId]: (voteData.bookVotes[bookId] || 0) + 1
      },
      userVotes: {
        ...voteData.userVotes,
        [user.id]: nextRecords
      }
    };

    await writeJsonFile(VOTE_FILE, nextVoteData);
    const stats = getUserVoteStats(user.id, nextVoteData);

    return {
      bookId,
      votes: nextVoteData.bookVotes[bookId],
      userVoteCount: stats.usedVotes,
      remainingVotes: stats.remainingVotes
    };
  });
}

async function handlePostVotes(request, response) {
  const user = requireAuthenticatedUser(request, response);

  if (!user) {
    return;
  }

  let payload;

  try {
    payload = await readRequestBody(request);
  } catch (error) {
    if (error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(response, 413, "REQUEST_BODY_TOO_LARGE", "请求体过大");
      return;
    }

    sendError(response, 400, "INVALID_JSON_BODY", "请求体不是合法 JSON");
    return;
  }

  if (!payload || typeof payload.bookId !== "string" || payload.bookId.trim() === "") {
    sendError(response, 400, "INVALID_BOOK_ID", "缺少有效的图书 ID");
    return;
  }

  try {
    const result = await addVote(payload.bookId, user);
    sendSuccess(response, result);
  } catch (error) {
    if (error.code === "BOOK_NOT_FOUND") {
      sendError(response, 404, "BOOK_NOT_FOUND", "图书不存在");
      return;
    }

    if (error.code === "VOTE_LIMIT_REACHED") {
      sendError(response, 403, "VOTE_LIMIT_REACHED", "每个用户最多可投 3 票");
      return;
    }

    console.error("Failed to write vote:", error);
    sendError(response, 500, "DATA_WRITE_ERROR", "投票数据写入失败");
  }
}

async function handleRegister(request, response) {
  let payload;

  try {
    payload = await readRequestBody(request);
  } catch (error) {
    if (error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(response, 413, "REQUEST_BODY_TOO_LARGE", "请求体过大");
      return;
    }

    sendError(response, 400, "INVALID_JSON_BODY", "请求体不是合法 JSON");
    return;
  }

  const username = normalizeUsername(payload.username);

  try {
    validateUsername(username);
    validatePassword(payload.password);
  } catch (error) {
    sendError(response, 400, error.code || "INVALID_AUTH_INPUT", error.message || "认证参数不合法");
    return;
  }

  try {
    const user = await createUser(username, payload.password);
    sendSuccess(response, user, 201);
  } catch (error) {
    if (error.code === "USERNAME_EXISTS") {
      sendError(response, 409, "USERNAME_EXISTS", "用户名已存在");
      return;
    }

    console.error("Failed to register user:", error);
    sendError(response, 500, "USER_WRITE_ERROR", "用户数据写入失败");
  }
}

async function handleLogin(request, response) {
  let payload;

  try {
    payload = await readRequestBody(request);
  } catch (error) {
    if (error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(response, 413, "REQUEST_BODY_TOO_LARGE", "请求体过大");
      return;
    }

    sendError(response, 400, "INVALID_JSON_BODY", "请求体不是合法 JSON");
    return;
  }

  const username = normalizeUsername(payload.username);

  try {
    validateUsername(username);
    validatePassword(payload.password);
  } catch {
    sendError(response, 401, "INVALID_CREDENTIALS", "用户名或密码错误");
    return;
  }

  try {
    const users = await readJsonFile(USER_FILE);
    const normalizedUsers = normalizeUsers(users);
    assertValidUsers(normalizedUsers);

    const user = normalizedUsers.find((item) => (
      item.username.toLowerCase() === username.toLowerCase()
    ));

    if (!user || !(await verifyPassword(payload.password, user))) {
      sendError(response, 401, "INVALID_CREDENTIALS", "用户名或密码错误");
      return;
    }

    const sessionId = createSession(user);
    sendSuccess(response, toPublicUser(user), 200, {
      "Set-Cookie": createSessionCookie(sessionId)
    });
  } catch (error) {
    console.error("Failed to login user:", error);
    sendError(response, 500, "USER_READ_ERROR", "用户数据读取失败");
  }
}

async function handleLogout(request, response) {
  const sessionId = getSessionId(request);

  if (sessionId) {
    sessions.delete(sessionId);
  }

  sendSuccess(response, { loggedOut: true }, 200, {
    "Set-Cookie": createClearSessionCookie()
  });
}

async function handleChangePassword(request, response) {
  const user = requireAuthenticatedUser(request, response);

  if (!user) {
    return;
  }

  let payload;

  try {
    payload = await readRequestBody(request);
  } catch (error) {
    if (error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(response, 413, "REQUEST_BODY_TOO_LARGE", "请求体过大");
      return;
    }

    sendError(response, 400, "INVALID_JSON_BODY", "请求体不是合法 JSON");
    return;
  }

  try {
    validatePassword(payload.currentPassword);
    validatePassword(payload.newPassword);
  } catch (error) {
    sendError(response, 400, error.code || "INVALID_PASSWORD", error.message || "密码格式不合法");
    return;
  }

  try {
    const result = await changeUserPassword(user.id, payload.currentPassword, payload.newPassword);
    sendSuccess(response, result);
  } catch (error) {
    if (error.code === "INVALID_CURRENT_PASSWORD") {
      sendError(response, 400, "INVALID_CURRENT_PASSWORD", "当前密码错误");
      return;
    }

    if (error.code === "USER_NOT_FOUND") {
      sendError(response, 404, "USER_NOT_FOUND", "用户不存在");
      return;
    }

    console.error("Failed to change password:", error);
    sendError(response, 500, "USER_WRITE_ERROR", "用户数据写入失败");
  }
}

async function handleGetMe(request, response) {
  const user = getCurrentUser(request);

  if (!user) {
    sendSuccess(response, {
      authenticated: false,
      user: null,
      voteLimit: VOTE_LIMIT,
      usedVotes: 0,
      remainingVotes: 0
    });
    return;
  }

  try {
    const books = await readJsonFile(BOOK_FILE);
    assertValidBooks(books);
    const votes = await readJsonFile(VOTE_FILE);
    const voteData = normalizeVoteData(votes, books);
    const stats = getUserVoteStats(user.id, voteData);

    sendSuccess(response, {
      authenticated: true,
      user,
      ...stats
    });
  } catch (error) {
    console.error("Failed to load current user vote stats:", error);
    sendError(response, 500, "DATA_READ_ERROR", "用户投票状态读取失败");
  }
}

async function handleAdminGetBooks(request, response) {
  if (!requireAdminUser(request, response)) {
    return;
  }

  await handleGetBooks(response);
}

async function handleAdminCreateBook(request, response) {
  if (!requireAdminUser(request, response)) {
    return;
  }

  let payload;

  try {
    payload = await readRequestBody(request);
  } catch (error) {
    if (error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(response, 413, "REQUEST_BODY_TOO_LARGE", "请求体过大");
      return;
    }

    sendError(response, 400, "INVALID_JSON_BODY", "请求体不是合法 JSON");
    return;
  }

  let title;

  try {
    title = validateBookTitle(payload.title);
  } catch (error) {
    sendError(response, 400, error.code || "INVALID_BOOK_TITLE", error.message || "书名不合法");
    return;
  }

  try {
    const book = await enqueueDataWrite(async () => {
      const books = await readJsonFile(BOOK_FILE);
      assertValidBooks(books);
      const votes = await readJsonFile(VOTE_FILE);
      const voteData = normalizeVoteData(votes, books);
      const id = generateBookId(books);
      const newBook = {
        id,
        title,
        author: "待补充",
        description: "待补充",
        coverUrl: DEFAULT_BOOK_COVER_URL
      };
      const nextBooks = [...books, newBook];
      const nextVoteData = {
        ...voteData,
        bookVotes: {
          ...voteData.bookVotes,
          [id]: 0
        }
      };

      await writeJsonFile(BOOK_FILE, nextBooks);
      await writeJsonFile(VOTE_FILE, nextVoteData);

      return {
        ...newBook,
        votes: 0
      };
    });

    sendSuccess(response, book, 201);
  } catch (error) {
    console.error("Failed to create book:", error);
    sendError(response, 500, "BOOK_WRITE_ERROR", "图书数据写入失败");
  }
}

async function handleAdminUpdateBook(request, response, bookId) {
  if (!requireAdminUser(request, response)) {
    return;
  }

  let payload;

  try {
    payload = await readRequestBody(request);
  } catch (error) {
    if (error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(response, 413, "REQUEST_BODY_TOO_LARGE", "请求体过大");
      return;
    }

    sendError(response, 400, "INVALID_JSON_BODY", "请求体不是合法 JSON");
    return;
  }

  let title;

  try {
    title = validateBookTitle(payload.title);
  } catch (error) {
    sendError(response, 400, error.code || "INVALID_BOOK_TITLE", error.message || "书名不合法");
    return;
  }

  try {
    const result = await enqueueDataWrite(async () => {
      const books = await readJsonFile(BOOK_FILE);
      assertValidBooks(books);
      const bookIndex = books.findIndex((book) => book.id === bookId);

      if (bookIndex === -1) {
        throw createCodedError("BOOK_NOT_FOUND", "图书不存在");
      }

      const nextBooks = books.map((book) => (
        book.id === bookId ? { ...book, title } : book
      ));
      const votes = await readJsonFile(VOTE_FILE);
      const voteData = normalizeVoteData(votes, nextBooks);

      await writeJsonFile(BOOK_FILE, nextBooks);

      return {
        ...nextBooks[bookIndex],
        votes: voteData.bookVotes[bookId] || 0
      };
    });

    sendSuccess(response, result);
  } catch (error) {
    if (error.code === "BOOK_NOT_FOUND") {
      sendError(response, 404, "BOOK_NOT_FOUND", "图书不存在");
      return;
    }

    console.error("Failed to update book:", error);
    sendError(response, 500, "BOOK_WRITE_ERROR", "图书数据写入失败");
  }
}

async function handleAdminDeleteBook(request, response, bookId) {
  if (!requireAdminUser(request, response)) {
    return;
  }

  try {
    const result = await enqueueDataWrite(async () => {
      const books = await readJsonFile(BOOK_FILE);
      assertValidBooks(books);
      const bookExists = books.some((book) => book.id === bookId);

      if (!bookExists) {
        throw createCodedError("BOOK_NOT_FOUND", "图书不存在");
      }

      const votes = await readJsonFile(VOTE_FILE);
      const voteData = normalizeVoteData(votes, books);
      const nextBooks = books.filter((book) => book.id !== bookId);
      const nextBookVotes = { ...voteData.bookVotes };
      delete nextBookVotes[bookId];

      const nextUserVotes = Object.fromEntries(
        Object.entries(voteData.userVotes).map(([userId, records]) => [
          userId,
          records.filter((record) => record.bookId !== bookId)
        ])
      );

      await writeJsonFile(BOOK_FILE, nextBooks);
      await writeJsonFile(VOTE_FILE, {
        bookVotes: nextBookVotes,
        userVotes: nextUserVotes
      });

      return {
        bookId,
        deleted: true
      };
    });

    sendSuccess(response, result);
  } catch (error) {
    if (error.code === "BOOK_NOT_FOUND") {
      sendError(response, 404, "BOOK_NOT_FOUND", "图书不存在");
      return;
    }

    console.error("Failed to delete book:", error);
    sendError(response, 500, "BOOK_WRITE_ERROR", "图书数据写入失败");
  }
}

async function handleAdminStartVoteRound(request, response) {
  if (!requireAdminUser(request, response)) {
    return;
  }

  try {
    const result = await enqueueDataWrite(async () => {
      const books = await readJsonFile(BOOK_FILE);
      assertValidBooks(books);
      const voteData = createDefaultVoteData(books);
      await writeJsonFile(VOTE_FILE, voteData);

      return {
        roundStarted: true,
        voteLimit: VOTE_LIMIT
      };
    });

    sendSuccess(response, result);
  } catch (error) {
    console.error("Failed to start vote round:", error);
    sendError(response, 500, "VOTE_ROUND_WRITE_ERROR", "新一轮投票写入失败");
  }
}

async function serveStatic(request, response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    sendError(response, 400, "INVALID_PATH", "资源路径不合法");
    return;
  }

  const publicRoot = path.resolve(PUBLIC_DIR);
  const filePath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);

  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
    sendError(response, 403, "FORBIDDEN", "禁止访问该资源");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const extension = path.extname(filePath);

    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendError(response, 404, "NOT_FOUND", "资源不存在");
      return;
    }

    console.error("Failed to serve static file:", error);
    sendError(response, 500, "STATIC_FILE_ERROR", "静态资源读取失败");
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname === "/api/books") {
    await handleGetBooks(response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/votes") {
    await handlePostVotes(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    await handleRegister(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    await handleLogin(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    await handleLogout(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/change-password") {
    await handleChangePassword(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    await handleGetMe(request, response);
    return;
  }

  if (url.pathname === "/api/admin/books") {
    if (request.method === "GET") {
      await handleAdminGetBooks(request, response);
      return;
    }

    if (request.method === "POST") {
      await handleAdminCreateBook(request, response);
      return;
    }
  }

  if (request.method === "POST" && url.pathname === "/api/admin/vote-rounds") {
    await handleAdminStartVoteRound(request, response);
    return;
  }

  const adminBookMatch = /^\/api\/admin\/books\/([^/]+)$/.exec(url.pathname);
  if (adminBookMatch) {
    const bookId = decodeURIComponent(adminBookMatch[1]);

    if (request.method === "PATCH") {
      await handleAdminUpdateBook(request, response, bookId);
      return;
    }

    if (request.method === "DELETE") {
      await handleAdminDeleteBook(request, response, bookId);
      return;
    }
  }

  if (url.pathname.startsWith("/api/")) {
    sendError(response, 404, "API_NOT_FOUND", "接口不存在");
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendError(response, 405, "METHOD_NOT_ALLOWED", "请求方法不支持");
    return;
  }

  await serveStatic(request, response, url.pathname);
}

async function startServer() {
  await ensureDataFiles();

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error("Unhandled request error:", error);
      sendError(response, 500, "INTERNAL_SERVER_ERROR", "服务器内部错误");
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, () => {
      server.off("error", reject);
      console.log(`Book voting app is running at http://localhost:${PORT}`);
      resolve();
    });
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
