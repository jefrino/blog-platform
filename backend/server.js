require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 4000;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be set and at least 32 characters long");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined
});

const allowedOrigins = (process.env.FRONTEND_ORIGIN || "http://127.0.0.1:5500")
  .split(",").map(s => s.trim()).filter(Boolean);

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  }
}));
app.use(express.json({ limit: "30kb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 300 }));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(30) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username));
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(160) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content VARCHAR(1200) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function makeToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: "7d" });
}
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Please log in to continue." });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: "Your session has expired. Please log in again." }); }
}
function validText(value, min, max) {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}
const publicUser = row => ({ id: row.id, username: row.username, email: row.email });

app.get("/api/health", (req, res) => res.json({ status: "ok", service: "blog-platform-api" }));

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const { username, email, password } = req.body || {};
    if (!validText(username, 3, 30) || !/^[a-zA-Z0-9_]+$/.test(username.trim()))
      return res.status(400).json({ error: "Username must be 3–30 characters (letters, numbers, underscores)." });
    if (!validText(email, 5, 255) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return res.status(400).json({ error: "Enter a valid email address." });
    if (!validText(password, 8, 100))
      return res.status(400).json({ error: "Password must be 8–100 characters." });
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO users(username,email,password_hash) VALUES($1,$2,$3) RETURNING id,username,email",
      [username.trim(), email.trim().toLowerCase(), hash]
    );
    const user = publicUser(result.rows[0]);
    res.status(201).json({ token: makeToken(user), user });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "That username or email is already registered." });
    next(err);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!validText(email, 5, 255) || typeof password !== "string")
      return res.status(400).json({ error: "Enter your email and password." });
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [email.trim().toLowerCase()]);
    const userRow = result.rows[0];
    if (!userRow || !(await bcrypt.compare(password, userRow.password_hash)))
      return res.status(401).json({ error: "Incorrect email or password." });
    const user = publicUser(userRow);
    res.json({ token: makeToken(user), user });
  } catch (err) { next(err); }
});

app.get("/api/auth/me", auth, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT id,username,email FROM users WHERE id=$1", [req.user.id]);
    if (!result.rows[0]) return res.status(401).json({ error: "User no longer exists." });
    res.json({ user: publicUser(result.rows[0]) });
  } catch (err) { next(err); }
});

app.get("/api/posts", async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT p.id,p.title,p.content,p.created_at,p.updated_at,
        u.id AS author_id,u.username AS author,
        (SELECT COUNT(*)::int FROM comments c WHERE c.post_id=p.id) AS comment_count
      FROM posts p JOIN users u ON u.id=p.user_id
      ORDER BY p.created_at DESC
    `);
    res.json({ posts: result.rows });
  } catch (err) { next(err); }
});

app.get("/api/posts/:id", async (req, res, next) => {
  try {
    const post = await pool.query(`
      SELECT p.id,p.title,p.content,p.created_at,p.updated_at,u.id AS author_id,u.username AS author
      FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=$1
    `, [req.params.id]);
    if (!post.rows[0]) return res.status(404).json({ error: "Post not found." });
    const comments = await pool.query(`
      SELECT c.id,c.content,c.created_at,u.id AS author_id,u.username AS author
      FROM comments c JOIN users u ON u.id=c.user_id
      WHERE c.post_id=$1 ORDER BY c.created_at ASC
    `, [req.params.id]);
    res.json({ post: post.rows[0], comments: comments.rows });
  } catch (err) { next(err); }
});

app.post("/api/posts", auth, async (req, res, next) => {
  try {
    const { title, content } = req.body || {};
    if (!validText(title, 3, 160) || !validText(content, 10, 20000))
      return res.status(400).json({ error: "Title must be 3–160 characters and content 10–20,000 characters." });
    const result = await pool.query(
      "INSERT INTO posts(user_id,title,content) VALUES($1,$2,$3) RETURNING id,title,content,created_at,updated_at",
      [req.user.id, title.trim(), content.trim()]
    );
    res.status(201).json({ post: { ...result.rows[0], author_id: req.user.id, author: req.user.username, comment_count: 0 } });
  } catch (err) { next(err); }
});

app.put("/api/posts/:id", auth, async (req, res, next) => {
  try {
    const { title, content } = req.body || {};
    if (!validText(title, 3, 160) || !validText(content, 10, 20000))
      return res.status(400).json({ error: "Title must be 3–160 characters and content 10–20,000 characters." });
    const result = await pool.query(
      `UPDATE posts SET title=$1,content=$2,updated_at=NOW()
       WHERE id=$3 AND user_id=$4 RETURNING id,title,content,created_at,updated_at`,
      [title.trim(), content.trim(), req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Post not found or you do not own it." });
    res.json({ post: { ...result.rows[0], author_id: req.user.id, author: req.user.username } });
  } catch (err) { next(err); }
});

app.delete("/api/posts/:id", auth, async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM posts WHERE id=$1 AND user_id=$2 RETURNING id", [req.params.id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Post not found or you do not own it." });
    res.json({ message: "Post deleted." });
  } catch (err) { next(err); }
});

app.post("/api/posts/:id/comments", auth, async (req, res, next) => {
  try {
    const { content } = req.body || {};
    if (!validText(content, 1, 1200)) return res.status(400).json({ error: "Comment must be 1–1,200 characters." });
    const post = await pool.query("SELECT id FROM posts WHERE id=$1", [req.params.id]);
    if (!post.rowCount) return res.status(404).json({ error: "Post not found." });
    const result = await pool.query(
      "INSERT INTO comments(post_id,user_id,content) VALUES($1,$2,$3) RETURNING id,content,created_at",
      [req.params.id, req.user.id, content.trim()]
    );
    res.status(201).json({ comment: { ...result.rows[0], author_id: req.user.id, author: req.user.username } });
  } catch (err) { next(err); }
});

app.delete("/api/comments/:id", auth, async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM comments WHERE id=$1 AND user_id=$2 RETURNING id", [req.params.id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Comment not found or you do not own it." });
    res.json({ message: "Comment deleted." });
  } catch (err) { next(err); }
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err.message === "Origin is not allowed by CORS") return res.status(403).json({ error: err.message });
  res.status(500).json({ error: "Something went wrong on the server." });
});

initDb().then(() => {
  app.listen(PORT, () => console.log(`Blog API listening on port ${PORT}`));
}).catch(err => {
  console.error("Database initialization failed:", err);
  process.exit(1);
});
