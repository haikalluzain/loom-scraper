import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPendingVideoJobs } from '../lib/db.js';
import { publishVideoJob, type VideoJobPayload } from '../lib/qstash.js';

// =============================================================================
// DEBUG ENDPOINT
// =============================================================================
// POST /api/debug
//
// Actions:
// - retry_failed: Re-publish failed/pending jobs to QStash
// - stats: Get pending job count from database
//
// WARNING: This endpoint should be protected or removed in production!
// =============================================================================

interface DebugRequest {
  action: 'retry_failed' | 'stats' | 'test_job';
  video_id?: string;
  cookies?: string;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<VercelResponse> {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action, video_id, cookies } = req.body as DebugRequest;

    switch (action) {
      case 'retry_failed': {
        const pending = await getPendingVideoJobs(100);
        let published = 0;

        for (const job of pending) {
          const payload: VideoJobPayload = {
            loom_video_id: job.loom_video_id,
            source_id: job.source_id,
            cookies: job.cookies,
          };
          await publishVideoJob(payload);
          published++;
        }

        return res.status(200).json({ 
          success: true, 
          message: `Re-published ${published} jobs` 
        });
      }

      case 'stats': {
        const pending = await getPendingVideoJobs(1000);
        return res.status(200).json({ 
          success: true, 
          pending_jobs: pending.length 
        });
      }

      case 'test_job': {
        if (!video_id) {
          return res.status(400).json({ error: 'video_id is required' });
        }

        const payload: VideoJobPayload = {
          loom_video_id: video_id,
          source_id: null,
          cookies: cookies || null,
        };

        await publishVideoJob(payload);
        return res.status(200).json({ 
          success: true, 
          message: `Published test job for ${video_id}` 
        });
      }

      default:
        return res.status(400).json({ error: 'Invalid action. Use: retry_failed, stats, test_job' });
    }
  } catch (error) {
    console.error('[Debug] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
