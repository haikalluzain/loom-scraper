import type { VercelRequest, VercelResponse } from '@vercel/node';
import { scrapeVideo } from '../../lib/loom/index.js';
import {
  createVideoJob,
  markJobProcessing,
  markJobCompleted,
  markJobFailed,
  saveVideo,
  getVideoByLoomId,
} from '../../lib/db.js';
import { verifyQStashSignature, type VideoJobPayload } from '../../lib/qstash.js';

// =============================================================================
// VIDEO WORKER
// =============================================================================
// POST /api/worker/video
//
// Called by QStash to process a single video.
// Scrapes video data and saves to database.
// =============================================================================

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<VercelResponse> {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify QStash signature
    const signature = req.headers['upstash-signature'] as string | undefined;
    const raw_body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    
    const is_valid = await verifyQStashSignature(signature, raw_body);
    if (!is_valid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Parse payload
    const payload: VideoJobPayload = typeof req.body === 'string' 
      ? JSON.parse(req.body) 
      : req.body;

    const { loom_video_id, source_id, cookies } = payload;

    if (!loom_video_id) {
      return res.status(400).json({ error: 'loom_video_id is required' });
    }

    console.log(`[VideoWorker] Processing: ${loom_video_id}`);

    // Check if recently scraped (within 24 hours)
    const existing = await getVideoByLoomId(loom_video_id);
    if (existing) {
      const hours_ago = (Date.now() - new Date(existing.updated_at).getTime()) / (1000 * 60 * 60);
      if (hours_ago < 24) {
        console.log(`[VideoWorker] Skipping ${loom_video_id} - scraped ${hours_ago.toFixed(1)}h ago`);
        return res.status(200).json({ success: true, skipped: true });
      }
    }

    // Create/update job record
    const job = await createVideoJob(loom_video_id, source_id || undefined, cookies || undefined);
    await markJobProcessing(job.id);

    // Scrape the video
    const video_data = await scrapeVideo(loom_video_id, cookies || undefined);

    if (!video_data) {
      await markJobFailed(job.id, 'Failed to scrape - may be private or unavailable');
      return res.status(200).json({ success: false, error: 'Scrape failed' });
    }

    // Save to database
    await saveVideo(video_data);
    await markJobCompleted(job.id);

    console.log(`[VideoWorker] Done: ${loom_video_id} - "${video_data.title}"`);
    return res.status(200).json({ success: true, video_id: loom_video_id });

  } catch (error) {
    console.error('[VideoWorker] Error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
}
