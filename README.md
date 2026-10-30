# Blog Platform — Full Stack

A complete blogging app with registration, login, posts, editing/deleting, and comments.

## Hosting architecture

- **Frontend:** GitHub Pages (static HTML/CSS/JS)
- **Backend:** Render (Node.js + Express REST API)
- **Database:** Neon PostgreSQL (or any hosted PostgreSQL)

> GitHub Pages cannot run Node.js or host a database. The frontend and backend are therefore deployed separately. This repository contains both.

## Features

- Register and log in with hashed passwords (bcrypt)
- JWT-based authentication
- Create, view, edit, and delete posts
- Add and delete comments
- Author-only post editing/deletion and comment deletion
- Responsive interface
- PostgreSQL persistence
- REST API, CORS, Helmet security headers, basic rate limiting

## 1. Create the database

1. Create a PostgreSQL database at https://neon.tech (or another PostgreSQL provider).
2. Copy its connection string.
3. Keep the connection string private. Do not put it in frontend files or commit it.

## 2. Deploy the backend to Render

1. Push this project to a GitHub repository.
2. In Render, create **New → Web Service** and select the repository.
3. Set **Root Directory** to `backend`.
4. Set **Build Command** to `npm install`.
5. Set **Start Command** to `npm start`.
6. Add environment variables:
   - `DATABASE_URL` = your PostgreSQL connection string
   - `JWT_SECRET` = a long random secret (at least 32 characters)
   - `FRONTEND_ORIGIN` = your GitHub Pages origin, e.g. `https://YOUR-USERNAME.github.io`
   - `NODE_ENV` = `production`
7. Deploy. Copy the service URL, e.g. `https://your-blog-api.onrender.com`.

The backend creates its tables automatically on startup. On Render's free tier, the service may sleep when idle; the first request can take a little longer.

## 3. Connect the frontend to the backend

Edit `frontend/config.js` and replace the placeholder with your deployed API URL:

```js
window.API_BASE_URL = "https://your-blog-api.onrender.com";
```

Do not add a trailing slash. This file contains only the public API URL, never secrets.

## 4. Publish frontend on GitHub Pages

1. In GitHub, open the repository → **Settings → Pages**.
2. Under Build and deployment, choose **Deploy from a branch**.
3. Select the branch (usually `main`) and folder `/frontend` is not selectable as a Pages source in every setup. Easiest option: use GitHub Actions to publish the `frontend` directory, or move/copy its contents to the repository root.
4. Recommended: use the included workflow at `.github/workflows/deploy-pages.yml`. In repository Settings → Pages, set Source to **GitHub Actions**.
5. Push to `main`; the workflow publishes `frontend/`.

Your site URL will look like `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.

## Local development

Requirements: Node.js 18+ and PostgreSQL.

```bash
cd backend
cp .env.example .env
# Edit .env and set DATABASE_URL and JWT_SECRET
npm install
npm run dev
```

Then edit `frontend/config.js` to:

```js
window.API_BASE_URL = "http://localhost:4000";
```

Open `frontend/index.html` using a local static server (for example VS Code Live Server), not by double-clicking the file.

## REST API

| Method | Endpoint | Authentication | Purpose |
|---|---|---:|---|
| GET | `/api/health` | No | Health check |
| POST | `/api/auth/register` | No | Register |
| POST | `/api/auth/login` | No | Login |
| GET | `/api/auth/me` | Yes | Current user |
| GET | `/api/posts` | No | List posts |
| GET | `/api/posts/:id` | No | Get one post and comments |
| POST | `/api/posts` | Yes | Create post |
| PUT | `/api/posts/:id` | Yes | Edit own post |
| DELETE | `/api/posts/:id` | Yes | Delete own post |
| POST | `/api/posts/:id/comments` | Yes | Add comment |
| DELETE | `/api/comments/:id` | Yes | Delete own comment |

## Important security notes

- Never commit `.env`, database credentials, or `JWT_SECRET`.
- Configure `FRONTEND_ORIGIN` to your exact GitHub Pages origin. For local development, use `http://127.0.0.1:5500` or your Live Server origin.
- This is a learning project. Before production use, consider email verification, password reset, stronger abuse prevention, moderation/reporting, and managed secret rotation.
