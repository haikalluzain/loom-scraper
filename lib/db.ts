import postgres from 'postgres';
import type {
  LoomVideo,
  VideoJob,
  ScrapeSource,
  PersistedVideo,
  ScrapeStatus,
  JobType,
} from './types.js';

// =============================================================================
// DATABASE CONFIGURATION
// =============================================================================

let sql: postgres.Sql | null = null;

/**
 * Get database connection using DATABASE_URL environment variable
 * Uses connection pooling optimized for serverless
 */
function getDb(): postgres.Sql {
  if (sql) return sql;

  const database_url = process.env.DATABASE_URL;
  if (!database_url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  // Configure for Supabase connection pooler (transaction mode)
  // Use ?pgbouncer=true or port 6543 in your connection string
  sql = postgres(database_url, {
    max: 1, // Single connection for serverless
    idle_timeout: 20, // Close idle connections after 20s
    connect_timeout: 10, // Connection timeout
    prepare: false, // Required for transaction mode pooler
  });

  return sql;
}

/**
 * Retry wrapper for database operations
 * Handles transient connection failures common in serverless
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  max_retries: number = 3,
  delay_ms: number = 500
): Promise<T> {
  let last_error: Error | undefined;

  for (let attempt = 1; attempt <= max_retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      last_error = error as Error;
      const is_connection_error = 
        last_error.message?.includes('fetch failed') ||
        last_error.message?.includes('connection') ||
        last_error.message?.includes('ECONNREFUSED') ||
        last_error.message?.includes('timeout') ||
        last_error.message?.includes('ENOTFOUND');

      if (!is_connection_error || attempt === max_retries) {
        throw last_error;
      }

      console.warn(`[DB] Retry ${attempt}/${max_retries} after error: ${last_error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay_ms * attempt));
    }
  }

  throw last_error;
}

// =============================================================================
// SCHEMA INITIALIZATION
// =============================================================================

/**
 * Initialize database schema
 * Creates tables if they don't exist
 *
 * Note: Run this once during deployment or use migrations
 */
export async function initializeSchema(): Promise<void> {
  const db = getDb();

  // Create scrape_sources table - tracks folder/video URLs submitted for scraping
  await db`
    CREATE TABLE IF NOT EXISTS scrape_sources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      url TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('video', 'folder')),
      cookies TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Create video_jobs table - individual video scrape jobs
  await db`
    CREATE TABLE IF NOT EXISTS video_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_id UUID REFERENCES scrape_sources(id) ON DELETE SET NULL,
      loom_video_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      error_message TEXT,
      cookies TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      UNIQUE(loom_video_id)
    )
  `;

  // Create videos table - persisted scraped video data
  await db`
    CREATE TABLE IF NOT EXISTS videos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      loom_video_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0,
      thumbnail TEXT,
      description TEXT,
      owner_name TEXT,
      owner_avatar_url TEXT,
      loom_created_at TIMESTAMPTZ,
      reactions JSONB NOT NULL DEFAULT '[]',
      comments JSONB NOT NULL DEFAULT '[]',
      transcript JSONB,
      chapters JSONB,
      tags JSONB NOT NULL DEFAULT '[]',
      raw_data JSONB NOT NULL,
      scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Create indexes for common queries
  await db`CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs(status)`;
  await db`CREATE INDEX IF NOT EXISTS idx_video_jobs_loom_id ON video_jobs(loom_video_id)`;
  await db`CREATE INDEX IF NOT EXISTS idx_videos_loom_id ON videos(loom_video_id)`;
  await db`CREATE INDEX IF NOT EXISTS idx_scrape_sources_status ON scrape_sources(status)`;

  console.log('[DB] Schema initialized successfully');
}

// =============================================================================
// SCRAPE SOURCES OPERATIONS
// =============================================================================

/**
 * Create a new scrape source (folder or video URL submission)
 */
export async function createScrapeSource(
  url: string,
  type: JobType,
  cookies?: string
): Promise<ScrapeSource> {
  const db = getDb();

  const [source] = await db`
    INSERT INTO scrape_sources (url, type, cookies, status)
    VALUES (${url}, ${type}, ${cookies || null}, 'pending')
    RETURNING *
  `;

  return source as ScrapeSource;
}

/**
 * Update scrape source status
 */
export async function updateScrapeSourceStatus(
  source_id: string,
  status: ScrapeStatus,
  error_message?: string
): Promise<void> {
  const db = getDb();

  await db`
    UPDATE scrape_sources
    SET status = ${status},
        error_message = ${error_message || null},
        updated_at = NOW()
    WHERE id = ${source_id}
  `;
}

// =============================================================================
// VIDEO JOBS OPERATIONS
// =============================================================================

/**
 * Create a video job (or update if exists)
 * Uses UPSERT to handle idempotency
 */
export async function createVideoJob(
  loom_video_id: string,
  source_id?: string,
  cookies?: string
): Promise<VideoJob> {
  return withRetry(async () => {
    const db = getDb();

    const [job] = await db`
      INSERT INTO video_jobs (loom_video_id, source_id, cookies, status)
      VALUES (${loom_video_id}, ${source_id || null}, ${cookies || null}, 'pending')
      ON CONFLICT (loom_video_id)
      DO UPDATE SET
        source_id = COALESCE(EXCLUDED.source_id, video_jobs.source_id),
        cookies = COALESCE(EXCLUDED.cookies, video_jobs.cookies),
        updated_at = NOW()
      RETURNING *
    `;

    return job as VideoJob;
  });
}

/**
 * Get pending video jobs for processing
 * Returns jobs that haven't exceeded max attempts
 */
export async function getPendingVideoJobs(limit: number = 10): Promise<VideoJob[]> {
  const db = getDb();

  const jobs = await db`
    SELECT * FROM video_jobs
    WHERE status IN ('pending', 'failed')
    AND attempt_count < max_attempts
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;

  return jobs as unknown as VideoJob[];
}

/**
 * Mark a video job as processing
 */
export async function markJobProcessing(job_id: string): Promise<void> {
  const db = getDb();

  await db`
    UPDATE video_jobs
    SET status = 'processing',
        attempt_count = attempt_count + 1,
        updated_at = NOW()
    WHERE id = ${job_id}
  `;
}

/**
 * Mark a video job as completed
 */
export async function markJobCompleted(job_id: string): Promise<void> {
  const db = getDb();

  await db`
    UPDATE video_jobs
    SET status = 'completed',
        processed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${job_id}
  `;
}

/**
 * Mark a video job as failed
 */
export async function markJobFailed(job_id: string, error_message: string): Promise<void> {
  const db = getDb();

  await db`
    UPDATE video_jobs
    SET status = 'failed',
        error_message = ${error_message},
        updated_at = NOW()
    WHERE id = ${job_id}
  `;
}

/**
 * Get job by loom video ID
 */
export async function getJobByLoomVideoId(loom_video_id: string): Promise<VideoJob | null> {
  const db = getDb();

  const [job] = await db`
    SELECT * FROM video_jobs
    WHERE loom_video_id = ${loom_video_id}
    LIMIT 1
  `;

  return (job as VideoJob) || null;
}

// =============================================================================
// VIDEOS OPERATIONS (PERSISTED DATA)
// =============================================================================

/**
 * Save or update scraped video data
 * Uses UPSERT for idempotency
 * Includes retry logic for connection failures
 */
export async function saveVideo(video: LoomVideo): Promise<PersistedVideo> {
  return withRetry(async () => {
    const db = getDb();

    const json = (val: unknown) => db.json(val as any);

    const [saved] = await db`
      INSERT INTO videos (
        loom_video_id,
        title,
        duration,
        thumbnail,
        description,
        owner_name,
        owner_avatar_url,
        loom_created_at,
        reactions,
        comments,
        transcript,
        chapters,
        tags,
        raw_data
      ) VALUES (
        ${video.id},
        ${video.title},
        ${Math.round(video.duration)},
        ${video.thumbnail},
        ${video.description},
        ${video.owner_name},
        ${video.owner_avatar_url},
        ${video.created_at},
        ${json(video.reactions)},
        ${json(video.comments)},
        ${video.transcript ? json(video.transcript) : null},
        ${video.chapters ? json(video.chapters) : null},
        ${json(video.tags)},
        ${json(video)}
      )
      ON CONFLICT (loom_video_id)
      DO UPDATE SET
        title = EXCLUDED.title,
        duration = EXCLUDED.duration,
        thumbnail = EXCLUDED.thumbnail,
        description = EXCLUDED.description,
        owner_name = EXCLUDED.owner_name,
        owner_avatar_url = EXCLUDED.owner_avatar_url,
        loom_created_at = EXCLUDED.loom_created_at,
        reactions = EXCLUDED.reactions,
        comments = EXCLUDED.comments,
        transcript = EXCLUDED.transcript,
        chapters = EXCLUDED.chapters,
        tags = EXCLUDED.tags,
        raw_data = EXCLUDED.raw_data,
        updated_at = NOW()
      RETURNING *
    `;

    console.log(`[DB] Saved video: ${video.id} - "${video.title}"`);
    return saved as PersistedVideo;
  });
}

/**
 * Get video by Loom video ID
 */
export async function getVideoByLoomId(loom_video_id: string): Promise<PersistedVideo | null> {
  return withRetry(async () => {
    const db = getDb();

    const [video] = await db`
      SELECT * FROM videos
      WHERE loom_video_id = ${loom_video_id}
      LIMIT 1
    `;

    return (video as PersistedVideo) || null;
  });
}

/**
 * Get all videos with pagination
 */
export async function getVideos(
  limit: number = 50,
  offset: number = 0
): Promise<{ videos: PersistedVideo[]; total: number }> {
  const db = getDb();

  const videos = await db`
    SELECT * FROM videos
    ORDER BY scraped_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  const [{ count }] = await db`SELECT COUNT(*) as count FROM videos`;

  return {
    videos: videos as unknown as PersistedVideo[],
    total: Number(count),
  };
}

/**
 * Get videos by source ID (all videos from a folder)
 */
export async function getVideosBySourceId(source_id: string): Promise<PersistedVideo[]> {
  const db = getDb();

  const videos = await db`
    SELECT v.* FROM videos v
    INNER JOIN video_jobs vj ON v.loom_video_id = vj.loom_video_id
    WHERE vj.source_id = ${source_id}
    ORDER BY v.scraped_at DESC
  `;

  return videos as unknown as PersistedVideo[];
}

/**
 * Check if video needs re-scraping based on last update time
 * Returns true if video was scraped more than 24 hours ago or doesn't exist
 */
export async function needsRescrape(loom_video_id: string, hours: number = 24): Promise<boolean> {
  const db = getDb();

  // Use raw interval calculation instead of INTERVAL with template
  const [result] = await db`
    SELECT 1 FROM videos
    WHERE loom_video_id = ${loom_video_id}
    AND updated_at > NOW() - (${hours} || ' hours')::INTERVAL
    LIMIT 1
  `;

  return !result;
}
