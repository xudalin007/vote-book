const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { promises: fs } = require("node:fs");

const USER_FILE = path.join(__dirname, "..", "user.json");
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
};

const scrypt = promisify(crypto.scrypt);

function validateUsername(username) {
  return /^[\u4e00-\u9fa5A-Za-z0-9_-]{2,32}$/.test(username);
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 6 && password.length <= 128;
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("base64")) {
  const derivedKey = await scrypt(password, salt, PASSWORD_KEY_LENGTH, PASSWORD_SCRYPT_OPTIONS);

  return {
    passwordSalt: salt,
    passwordHash: derivedKey.toString("base64")
  };
}

async function readUsers() {
  try {
    const content = await fs.readFile(USER_FILE, "utf8");
    const users = JSON.parse(content);
    return Array.isArray(users) ? users : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function main() {
  const username = (process.env.ADMIN_USERNAME || "").trim();
  const password = process.env.ADMIN_PASSWORD || "";

  if (!validateUsername(username) || !validatePassword(password)) {
    console.error("Usage: ADMIN_USERNAME=admin ADMIN_PASSWORD=yourPassword npm run create-admin");
    console.error("Username must be 2-32 chars; password must be 6-128 chars.");
    process.exit(1);
  }

  const users = await readUsers();
  const normalizedUsers = users.map((user) => ({
    ...user,
    role: user.role === "admin" ? "admin" : "user"
  }));
  const existingIndex = normalizedUsers.findIndex((user) => (
    user.username.toLowerCase() === username.toLowerCase()
  ));
  const passwordData = await hashPassword(password);

  if (existingIndex >= 0) {
    normalizedUsers[existingIndex] = {
      ...normalizedUsers[existingIndex],
      role: "admin",
      passwordHash: passwordData.passwordHash,
      passwordSalt: passwordData.passwordSalt
    };
  } else {
    normalizedUsers.push({
      id: `user-${crypto.randomBytes(8).toString("hex")}`,
      username,
      role: "admin",
      passwordHash: passwordData.passwordHash,
      passwordSalt: passwordData.passwordSalt,
      createdAt: new Date().toISOString()
    });
  }

  await fs.writeFile(USER_FILE, `${JSON.stringify(normalizedUsers, null, 2)}\n`, "utf8");
  console.log(`Admin user is ready: ${username}`);
}

main().catch((error) => {
  console.error("Failed to create admin user:", error);
  process.exit(1);
});
