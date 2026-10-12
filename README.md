# YouTube Subtitle Manager

A complete, local-first full-stack application for archiving, managing, and syncing YouTube subtitles. Built with **Next.js (App Router, TypeScript, Tailwind CSS)**, **FastAPI (Python, SQLAlchemy, Alembic)**, **PostgreSQL**, **yt-dlp**, and **Google Drive OAuth**.

---

## 🚀 Features

- **Separated Architecture:** Modern Next.js TypeScript frontend and high-performance FastAPI backend.
- **Secure Authentication & Scoping:** JWT-based user authentication, password hashing with bcrypt, and strict per-user authorization preventing cross-user data access.
- **YouTube Ingestion:** Processes standard YouTube videos, Shorts (`/shorts/`), and playlists (`/playlist?list=...`), with per-user duplicate detection (`UNIQUE(user_id, video_id)`).
- **Intelligent Subtitle Selection & 429 Resilience:** Prefers human/manual English captions; automatically falls back to auto-generated English captions; handles videos without subtitles and failures gracefully without crashing. Automatically recovers from transient YouTube HTTP 429 rate limits with configurable bounded exponential backoff.
- **Retryable Ingestion on Rate Limits:** When subtitle extraction fails specifically due to temporary YouTube HTTP 429 rate limiting, subsequent submissions of the URL reprocess the existing record instead of being permanently rejected as duplicates. Ordinary duplicates and non-rate-limited failures remain deduplicated.
- **Isolated Google Drive Sync:** Direct OAuth2 integration that uploads subtitles to Google Drive and deletes local temporary subtitle artifacts *only after confirmed upload*.
- **Comprehensive Video Library:** Backend search (title, channel, video ID), status filtering, editing status and ChatGPT conversation links, direct external links, and record deletion without deleting Google Drive files.
- **Robust Automated Tests:** Comprehensive pytest suite covering authentication, user isolation, URL parsing, subtitle selection, 429 retry backoff, Drive uploads, duplicate detection, and library management with mocked external dependencies.

---

## 🛠 Tech Stack

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Lucide React
- **Backend:** FastAPI, Python 3.11+, SQLAlchemy 2.0, Alembic, Pydantic v2
- **Database:** PostgreSQL (with SQLite support for unit testing)
- **External Tools:** `yt-dlp` (no YouTube cookies required), Google Drive API v3
- **Containerization:** Docker, Docker Compose

---

## 📋 Prerequisites

- **Python 3.11+**
- **Node.js 18+** & **npm**
- **Docker & Docker Compose** (optional for containerized setup)
- **PostgreSQL 14+** (if running directly without Docker; SQLite can also be used for local testing)

---

## ⚡ Quick Start: Docker Compose

The fastest way to spin up the entire stack (PostgreSQL database, FastAPI backend, and Next.js frontend) is using Docker Compose:

1. **Clone the repository and enter the directory:**
   ```powershell
   cd "C:\Users\toanv\OneDrive\Desktop\Youtube subtitle manager"
   ```

2. **Create the environment file:**
   ```powershell
   Copy-Item .env.example .env
   ```

3. **Start services:**
   ```powershell
   docker compose up --build
   ```

4. **Access the application:**
   - **Frontend:** [http://localhost:3000](http://localhost:3000)
   - **Backend API Docs (Swagger):** [http://localhost:8000/docs](http://localhost:8000/docs)
   - **API Health Check:** [http://localhost:8000/health](http://localhost:8000/health)

---

## 💻 Direct Local Development Setup (Windows PowerShell)

### 1. Backend Setup

1. **Navigate to the backend folder and create a virtual environment:**
   ```powershell
   cd backend
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   ```

2. **Install Python dependencies:**
   ```powershell
   pip install -r requirements.txt
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in `backend/` or root (refer to `.env.example`).
   ```env
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/youtube_subtitles
   SECRET_KEY=super-secret-jwt-key-min-32-chars-long
   FRONTEND_URL=http://localhost:3000
   GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   GOOGLE_REDIRECT_URI=http://localhost:8000/api/drive/callback
   SUBTITLE_MAX_RETRIES=3
   SUBTITLE_RETRY_DELAY=1.0
   ```

   *(Note: If testing locally without PostgreSQL, you can use SQLite: `DATABASE_URL=sqlite:///./dev.db`)*
   *(Note: `SUBTITLE_MAX_RETRIES` sets bounded retry attempts for HTTP 429 rate limits; `SUBTITLE_RETRY_DELAY` sets the initial backoff delay in seconds.)*

4. **Run Alembic Migrations:**
   ```powershell
   alembic upgrade head
   ```

5. **Start FastAPI Development Server:**
   ```powershell
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```
   *(Note: Development and server access logs automatically sanitize OAuth callback requests by redacting authorization codes and sensitive parameters, e.g. `GET /api/drive/callback?code=[REDACTED]&state=...`, preventing raw codes from being retained in log outputs or storage.)*

---

### 2. Frontend Setup

1. **Open a new PowerShell terminal and navigate to the frontend folder:**
   ```powershell
   cd frontend
   ```

2. **Install Node.js dependencies:**
   ```powershell
   npm install
   ```

3. **Start Next.js Development Server:**
   ```powershell
   npm run dev
   ```

4. **Open in browser:**
   Visit [http://localhost:3000](http://localhost:3000).

---

## 🔑 Google Drive OAuth 2.0 Setup Guide

To enable uploading subtitles directly to Google Drive:

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g. `YouTube Subtitle Manager`).
3. Under **APIs & Services > Library**, search for **Google Drive API** and click **Enable**.
4. Go to **APIs & Services > OAuth consent screen**:
   - Choose **External** (or Internal for Workspace).
   - Enter App Name and support email.
   - Under Scopes, add `.../auth/drive.file`.
   - Add your Google account as a Test User if the app is in testing mode.
5. Go to **APIs & Services > Credentials**:
   - Click **Create Credentials > OAuth client ID**.
   - Select Application type: **Web application**.
   - Under **Authorized redirect URIs**, add:
     `http://localhost:8000/api/drive/callback`
6. Copy the **Client ID** and **Client Secret** into your `.env` file:
   ```env
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxxxxxx
   ```
7. On the frontend dashboard, click **Connect Drive** to authorize.

### 🔧 Troubleshooting OAuth Errors (Google Cloud Console Checks)

When a token exchange fails, the server records a safe structured diagnostic indicating the provider error class without logging sensitive authorization codes, tokens, or client secrets. Development and server access logs are also automatically sanitized so authorization codes are never retained in server logs (`code=[REDACTED]`). The frontend displays an actionable configuration error. If you encounter an OAuth error, verify the following settings in Google Cloud Console:

1. **`invalid_client` (Client Identification or Secret Mismatch)**
   - **Google Cloud Console Location:** **APIs & Services > Credentials** > Click your OAuth 2.0 Client ID under **OAuth 2.0 Client IDs**.
   - **Values to Compare:**
     - **Client ID:** Compare the **Client ID** displayed in the console with `GOOGLE_CLIENT_ID` in your `.env`. Verify there are no missing characters or trailing whitespace.
     - **Client Secret:** Compare the **Client secret** displayed in the console with `GOOGLE_CLIENT_SECRET` in your `.env`. If the secret was reset or regenerated, update `.env` with the new value.
     - **Application Type:** Verify that the client is configured as **Web application** (not Desktop app, Android, iOS, or Service Account).
     - **API Enabled:** Ensure the credential belongs to the project where **Google Drive API** is enabled under **APIs & Services > Enabled APIs & services**.

2. **`invalid_grant` (Expired, Reused, or Unauthorized Token Request)**
   - **Google Cloud Console Location:** **APIs & Services > OAuth consent screen**.
   - **Values & Configuration to Check:**
     - **Test Users:** If your consent screen **Publishing status** is **Testing**, verify that the Google account you are authenticating with is listed under **Test users**. Accounts not listed cannot exchange tokens in testing mode.
     - **Fresh Authorization Code:** OAuth authorization codes expire within minutes and can only be used once. If a request was interrupted or failed, return to the dashboard and initiate a fresh consent request.
     - **System Clock Synchronization:** Ensure your host machine's system clock is synchronized with network time (NTP / Windows Time). Clock skew between your machine and Google servers can invalidate authorization codes.
     - **Confidential Client Web Flow:** Ensure PKCE code verifier autogeneration is disabled (`autogenerate_code_verifier=False`) so the confidential web server authorization code grant functions properly with client secret.

3. **`redirect_uri_mismatch` (Redirect URI Configuration Error)**
   - **Google Cloud Console Location:** **APIs & Services > Credentials** > Select your Web Application client > **Authorized redirect URIs**.
   - **Values to Compare:**
     - The URI configured in `GOOGLE_REDIRECT_URI` (`http://localhost:8000/api/drive/callback`) must match an entry in **Authorized redirect URIs** exactly, character-for-character.
     - **Scheme:** `http://` for local development (not `https://` unless using local SSL).
     - **Host:** `localhost` vs `127.0.0.1` (Google treats these as separate domains; they must match your browser navigation host).
     - **Port:** Exact port matching (`:8000`).
     - **Path:** `/api/drive/callback` (ensure no trailing slash unless also registered with a trailing slash).

---

## 🧪 Verification & Testing

### Backend Automated Tests

Run the full pytest suite (covering authentication, user isolation, YouTube extraction, subtitle selection preference, Drive upload/cleanup, duplicate detection, search, and filtering):

```powershell
cd backend
.\venv\Scripts\python -m pytest -v tests
```

### Frontend Typecheck & Build

Ensure TypeScript types and Next.js production builds compile with zero errors:

```powershell
cd frontend
npm run typecheck
npm run build
```

---

## 📂 Project Structure

```
.
├── backend/
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/
│   │       └── 001_initial_schema.py
│   ├── alembic.ini
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth.py          # Register, login, me, logout
│   │   │   ├── deps.py          # Auth dependencies & DB session
│   │   │   ├── drive.py         # Google Drive OAuth endpoints
│   │   │   └── videos.py        # Ingestion, search, filter, edit, delete
│   │   ├── models/
│   │   │   ├── user.py          # User SQLAlchemy model
│   │   │   └── video.py         # Video SQLAlchemy model with UNIQUE(user_id, video_id)
│   │   ├── schemas/             # Pydantic v2 schemas
│   │   ├── services/
│   │   │   ├── auth_service.py      # Password hashing & JWT
│   │   │   ├── drive_service.py     # Isolated Drive OAuth & conditional file deletion
│   │   │   ├── subtitle_service.py  # Caption download & manual/auto selection
│   │   │   └── youtube_service.py   # Video, Shorts & playlist extraction
│   │   ├── config.py
│   │   ├── database.py
│   │   └── main.py
│   ├── tests/                   # 29 Comprehensive pytest tests
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── dashboard/page.tsx # Video library with search & filter
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   ├── globals.css
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   │   ├── IngestModal.tsx
│   │   │   ├── EditModal.tsx
│   │   │   └── Navbar.tsx
│   │   ├── lib/
│   │   │   ├── api.ts           # Typed API client
│   │   │   └── auth.tsx         # React Auth context
│   │   └── types/index.ts
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── next.config.mjs
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

---

## 🔒 Security & Privacy Notes
 
 - Plaintext passwords and secrets are never committed to version control.
 - yt-dlp runs without requiring YouTube account cookies.
 - All video library records and operations are strictly scoped to the authenticated user ID.
 - Google Drive file access is scoped to the `drive.file` permission. Deleting a video record in the application library does not delete files from your Google Drive account.
 - Development and server access logs never retain OAuth callback authorization codes, tokens, or client secrets. Raw callback authorization codes in `GET /api/drive/callback?code=...` are automatically intercepted and sanitized (`code=[REDACTED]`) before access logs are recorded.
