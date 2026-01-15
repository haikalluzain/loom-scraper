import type { VercelRequest, VercelResponse } from '@vercel/node';
import { extractVideoId, extractFolderId } from '../lib/loom/index.js';
import { createScrapeSource } from '../lib/db.js';
import { publishVideoJob, publishFolderJob } from '../lib/qstash.js';
import type { EnqueueRequest, EnqueueResponse, JobType } from '../lib/types.js';

// =============================================================================
// ENQUEUE ENDPOINT
// =============================================================================
// POST /api/enqueue
//
// This endpoint returns IMMEDIATELY after publishing to QStash.
// All processing happens asynchronously in workers.
//
// For videos: Publishes directly to video worker
// For folders: Publishes to folder worker (which then publishes video jobs)
// =============================================================================

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<VercelResponse> {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    } satisfies EnqueueResponse);
  }

  try {
    const body = req.body as EnqueueRequest;
    const { url, type } = body;
    
    // Normalize cookies
    const cookies = body.cookies 
      ? (typeof body.cookies === 'string' ? body.cookies : JSON.stringify(body.cookies))
      : undefined;

    // Validate
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' } satisfies EnqueueResponse);
    }

    if (!type || !['video', 'folder'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Type must be "video" or "folder"' } satisfies EnqueueResponse);
    }

    // Create source record (quick DB insert)
    const source = await createScrapeSource(url, type as JobType, cookies);

    if (type === 'video') {
      const video_id = extractVideoId(url);
      if (!video_id) {
        return res.status(400).json({ success: false, error: 'Invalid Loom video URL' } satisfies EnqueueResponse);
      }

      // Publish to QStash and return immediately
      await publishVideoJob({
        loom_video_id: video_id,
        source_id: source.id,
        cookies: cookies || null,
      });

    } else {
      const folder_id = extractFolderId(url);
      if (!folder_id) {
        return res.status(400).json({ success: false, error: 'Invalid Loom folder URL' } satisfies EnqueueResponse);
      }

      // Publish folder job - folder worker will handle expansion
      await publishFolderJob({
        folder_id,
        source_id: source.id,
        cookies: cookies || null,
      });
    }

    // Return immediately - processing happens async
    return res.status(202).json({
      success: true,
      source_id: source.id,
    } satisfies EnqueueResponse);

  } catch (error) {
    console.error('[Enqueue] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    } satisfies EnqueueResponse);
  }
}
