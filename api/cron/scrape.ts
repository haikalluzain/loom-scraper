import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPendingVideoJobs } from '../../lib/db.js';
import { publishVideoJob, type VideoJobPayload } from '../../lib/qstash.js';
import type { CronResponse } from '../../lib/types.js';

// =============================================================================
// CRON SCRAPE ENDPOINT
// =============================================================================
// GET /api/cron/scrape
//
// This cron job runs daily (configured in vercel.json).
// With QStash, it only needs to:
// - Re-queue any failed/pending jobs from the database
// - QStash handles the actual job delivery and retries
//
// Security: Protected by Vercel's CRON_SECRET header
// =============================================================================

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<VercelResponse> {
  // Verify cron secret in production
  const cron_secret = process.env.CRON_SECRET;
  const authorization = req.headers.authorization;

  if (cron_secret && authorization !== `Bearer ${cron_secret}`) {
    console.log('[Cron] Unauthorized request');
    return res.status(401).json({
      success: false,
      errors: ['Unauthorized'],
    } satisfies CronResponse);
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      errors: ['Method not allowed'],
    } satisfies CronResponse);
  }

  const errors: string[] = [];
  let jobs_published = 0;

  try {
    console.log('[Cron] Starting maintenance job');

    // Get pending/failed jobs from database
    const pending_jobs = await getPendingVideoJobs(100);

    if (pending_jobs.length === 0) {
      console.log('[Cron] No pending jobs to re-queue');
      return res.status(200).json({
        success: true,
        jobs_processed: 0,
      } satisfies CronResponse);
    }

    console.log(`[Cron] Found ${pending_jobs.length} pending jobs to re-queue`);

    // Re-publish each job to QStash
    for (const job of pending_jobs) {
      try {
        const payload: VideoJobPayload = {
          loom_video_id: job.loom_video_id,
          source_id: job.source_id,
          cookies: job.cookies,
        };

        await publishVideoJob(payload);
        jobs_published++;
      } catch (error) {
        const err_msg = `Failed to publish ${job.loom_video_id}: ${error instanceof Error ? error.message : 'Unknown'}`;
        console.error(`[Cron] ${err_msg}`);
        errors.push(err_msg);
      }
    }

    console.log(`[Cron] Published ${jobs_published}/${pending_jobs.length} jobs`);

    return res.status(200).json({
      success: errors.length === 0,
      jobs_processed: jobs_published,
      errors: errors.length > 0 ? errors : undefined,
    } satisfies CronResponse);
  } catch (error) {
    console.error('[Cron] Fatal error:', error);
    return res.status(500).json({
      success: false,
      jobs_processed: jobs_published,
      errors: [error instanceof Error ? error.message : 'Internal server error'],
    } satisfies CronResponse);
  }
}
