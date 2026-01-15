# Loom Scraper

A production-ready backend service for scraping Loom video metadata, built for Vercel Serverless Functions.

## Architecture

This service is designed to reliably scrape Loom videos without timeouts:

- **Queue-based processing**: Each video is processed independently via QStash
- **Idempotent operations**: Safe to run repeatedly without duplicating work
- **Graceful failure handling**: Individual video failures don't affect others
- **Persistent storage**: All scraped data is stored in Supabase Postgres

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   /api/enqueue  │────▶│  Upstash QStash │────▶│ /api/worker/    │
│   (Add jobs)    │     │  (Job Queue)    │     │  video | folder │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   /api/videos   │◀────│    Supabase     │◀────│  Loom GraphQL   │
│   (Read data)   │     │    Postgres     │     │      API        │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Tech Stack

- **Runtime**: Node.js 20+ on Vercel Serverless Functions
- **Database**: Supabase Postgres (with connection pooler)
- **Queue**: Upstash QStash (push-based message delivery)
- **Scheduling**: Vercel Cron

## API Endpoints

### `POST /api/enqueue`

Submit a video or folder URL for scraping.

```json
{
  "url": "https://www.loom.com/share/abc123",
  "type": "video",
  "cookies": "optional session cookies"
}
```

For folders:

```json
{
  "url": "https://www.loom.com/spaces/folder-xyz",
  "type": "folder",
  "cookies": "required for folder access"
}
```

### `POST /api/worker/video`

Process a single video. **Called automatically by QStash** - you don't need to call this manually.

### `POST /api/worker/folder`

Process a folder (lists videos and processes them in batches). **Called automatically by QStash**.

### `GET /api/cron/scrape`

Cron endpoint that runs daily to recover stuck jobs and re-queue failed ones.

### `GET /api/videos`

Query scraped video data.

```bash
# Get all videos
GET /api/videos?limit=50&offset=0

# Get specific video
GET /api/videos?id=abc123

# Get videos from a source (folder)
GET /api/videos?source_id=uuid
```

### `GET /api/health`

Health check endpoint for database connectivity.

### `POST /api/init`

Initialize database schema. Run once during setup.

## Data Shape

Each scraped video includes:

```typescript
{
  id: string;
  title: string;
  duration: number;
  thumbnail: string | null;
  description: string | null;
  owner_name: string | null;
  owner_avatar_url: string | null;
  created_at: string | null;
  reactions: Reaction[];
  comments: Comment[];
  transcript: TranscriptSegment[] | null;
  chapters: Chapter[] | null;
  tags: string[];
}
```

## Setup

### 1. Environment Variables

Create `.env.local` with:

```bash
# Supabase Postgres (use connection pooler for serverless)
# Get this from: Supabase Dashboard → Project Settings → Database → Connection pooling (Transaction mode)
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

# Upstash QStash (for job queue)
QSTASH_TOKEN=your_qstash_token
QSTASH_CURRENT_SIGNING_KEY=sig_xxx
QSTASH_NEXT_SIGNING_KEY=sig_xxx

# Your deployment URL (for QStash webhook callbacks)
QSTASH_WEBHOOK_URL=https://your-app.vercel.app

# Optional: Protect cron endpoints
CRON_SECRET=your_secret_here
```

> **Important**: Use Supabase's **Transaction mode pooler** (port `6543`) for serverless, not the direct connection (port `5432`).

### 2. Initialize Database

```bash
curl -X POST https://your-app.vercel.app/api/init \
  -H "Authorization: Bearer your_cron_secret"
```

### 3. Deploy

```bash
vercel deploy
```

## Local Development

```bash
# Install dependencies
pnpm install

# Run locally (requires Vercel CLI)
vercel dev
```

## How It Works

### Single Video Flow

1. Client POSTs to `/api/enqueue` with video URL
2. Source record created in Postgres
3. Job published to QStash → returns immediately!
4. QStash calls `/api/worker/video` with the job
5. Worker scrapes video and saves to Postgres
6. Client queries `/api/videos` for results

### Folder Flow

1. Client POSTs to `/api/enqueue` with folder URL and cookies
2. Job published to QStash → returns immediately!
3. QStash calls `/api/worker/folder`
4. Folder worker fetches video list and processes in batches (5 concurrent, 10 per execution)
5. If more videos remain, worker chains itself via QStash
6. All videos processed without timeout issues

### Why QStash?

- **Push-based**: QStash calls your endpoint (no polling)
- **Fast response**: Enqueue returns immediately
- **Automatic retries**: Built-in retry with backoff
- **Signature verification**: Secure webhook delivery
- **Chained execution**: Large folders handled via self-chaining

### Cron Job

Runs daily to recover stuck jobs and re-queue failed ones from the database.

## Scraping Features

- **OEmbed API**: Basic video info (title, thumbnail, duration)
- **Page scraping**: Additional metadata from video pages
- **GraphQL API**: Comments, reactions, chapters
- **CDN**: Transcripts with timestamps
- **Folder listing**: Video IDs from folders (requires auth)

## Production Considerations

- **Rate limiting**: Consider adding rate limits for public endpoints
- **Monitoring**: Add error tracking (Sentry, etc.)
- **Caching**: Add CDN caching for `/api/videos` responses
- **Authentication**: Protect write endpoints in production

## License

Private - Internal use only
