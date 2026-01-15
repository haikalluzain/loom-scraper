import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchFolderVideos, scrapeVideo } from '../../lib/loom/index.js';
import { updateScrapeSourceStatus, createVideoJob, markJobProcessing, markJobCompleted, markJobFailed, saveVideo, getVideoByLoomId } from '../../lib/db.js';
import { verifyQStashSignature, publishFolderJob, type FolderJobPayload } from '../../lib/qstash.js';

// =============================================================================
// FOLDER WORKER
// =============================================================================
// POST /api/worker/folder
//
// Processes a folder using chained execution:
// 1. First call: Fetches all video IDs, processes a batch, chains to next batch
// 2. Subsequent calls: Receives video_ids, processes batch, chains if more remain
//
// This allows processing unlimited videos without timeout issues.
// =============================================================================

const BATCH_SIZE = 10; // Process 10 videos concurrently
const VIDEOS_PER_EXECUTION = 20; // Videos per QStash call (2 batches of 3)

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
    const payload: FolderJobPayload = typeof req.body === 'string' 
      ? JSON.parse(req.body) 
      : req.body;

    const { folder_id, source_id, cookies, video_ids: incoming_video_ids } = payload;

    if (!folder_id) {
      return res.status(400).json({ error: 'folder_id is required' });
    }

    let all_video_ids: string[];

    // First call: fetch video IDs from folder
    if (!incoming_video_ids) {
      console.log(`[FolderWorker] Initial call for folder: ${folder_id}`);
      
      const result = await fetchFolderVideos(folder_id, cookies || undefined);

      if (!result.success) {
        await updateScrapeSourceStatus(source_id, 'failed', result.error);
        return res.status(200).json({ success: false, error: result.error });
      }

      const videos = result.videos || [];
      
      if (videos.length === 0) {
        await updateScrapeSourceStatus(source_id, 'completed');
        return res.status(200).json({ success: true, videos_found: 0 });
      }

      all_video_ids = videos.map(v => v.id);
      console.log(`[FolderWorker] Found ${all_video_ids.length} videos to process`);
    } else {
      // Subsequent call: use provided video IDs
      all_video_ids = incoming_video_ids;
      console.log(`[FolderWorker] Continuing with ${all_video_ids.length} remaining videos`);
    }

    // Split into current batch and remaining
    const current_batch = all_video_ids.slice(0, VIDEOS_PER_EXECUTION);
    const remaining = all_video_ids.slice(VIDEOS_PER_EXECUTION);

    // Process current batch
    const start_time = Date.now();
    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < current_batch.length; i += BATCH_SIZE) {
      const batch = current_batch.slice(i, i + BATCH_SIZE);
      
      const results = await Promise.allSettled(
        batch.map(video_id => processVideo(video_id, source_id, cookies))
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value.skipped) skipped++;
          else if (result.value.success) processed++;
          else failed++;
        } else {
          failed++;
        }
      }
    }

    const duration_ms = Date.now() - start_time;
    const duration_s = (duration_ms / 1000).toFixed(2);
    console.log(`[FolderWorker] Batch done: processed=${processed}, skipped=${skipped}, failed=${failed} (${duration_s}s)`);

    // Chain to next batch if there are remaining videos
    if (remaining.length > 0) {
      console.log(`[FolderWorker] Chaining to process ${remaining.length} more videos`);
      
      await publishFolderJob({
        folder_id,
        source_id,
        cookies,
        video_ids: remaining,
      });

      return res.status(200).json({ 
        success: true, 
        processed,
        skipped,
        failed,
        remaining: remaining.length,
        duration_ms,
        status: 'chained',
      });
    }

    // All done
    await updateScrapeSourceStatus(source_id, 'completed');
    
    return res.status(200).json({ 
      success: true, 
      processed,
      skipped,
      failed,
      remaining: 0,
      duration_ms,
      status: 'completed',
    });

  } catch (error) {
    console.error('[FolderWorker] Error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
}

// =============================================================================
// HELPER
// =============================================================================

interface ProcessResult {
  success: boolean;
  skipped?: boolean;
  error?: string;
}

async function processVideo(
  loom_video_id: string,
  source_id: string,
  cookies: string | null
): Promise<ProcessResult> {
  try {
    // Check if recently scraped
    const existing = await getVideoByLoomId(loom_video_id);
    if (existing) {
      const hours_ago = (Date.now() - new Date(existing.updated_at).getTime()) / (1000 * 60 * 60);
      if (hours_ago < 24) {
        return { success: true, skipped: true };
      }
    }

    // Create job record
    const job = await createVideoJob(loom_video_id, source_id, cookies || undefined);
    await markJobProcessing(job.id);

    // Scrape
    const video_data = await scrapeVideo(loom_video_id, cookies || undefined);

    if (!video_data) {
      await markJobFailed(job.id, 'Scrape failed');
      return { success: false, error: 'Scrape failed' };
    }

    // Save
    await saveVideo(video_data);
    await markJobCompleted(job.id);

    console.log(`[FolderWorker] Scraped: ${loom_video_id}`);
    return { success: true };

  } catch (error) {
    console.error(`[FolderWorker] Error processing ${loom_video_id}:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
