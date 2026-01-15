import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getVideos, getVideoByLoomId, getVideosBySourceId } from '../lib/db.js';
import type { VideoResponse, LoomVideo } from '../lib/types.js';

// =============================================================================
// VIDEOS API ENDPOINT
// =============================================================================
// GET /api/videos
//
// Query parameters:
// - id: Get a specific video by Loom video ID
// - source_id: Get all videos from a specific source (folder)
// - limit: Number of videos to return (default: 50, max: 100)
// - offset: Pagination offset (default: 0)
//
// This is a READ-ONLY endpoint for external consumers.
// It returns scraped video data from the database.
// =============================================================================

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<VercelResponse> {
  // CORS headers for external consumers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    } satisfies VideoResponse);
  }

  try {
    const { id, source_id, limit: limit_str, offset: offset_str } = req.query;

    // Get single video by Loom ID
    if (id && typeof id === 'string') {
      return await handleGetVideoById(id, res);
    }

    // Get videos by source ID (folder)
    if (source_id && typeof source_id === 'string') {
      return await handleGetVideosBySource(source_id, res);
    }

    // List all videos with pagination
    const limit = Math.min(parseInt(limit_str as string) || 50, 100);
    const offset = parseInt(offset_str as string) || 0;

    return await handleListVideos(limit, offset, res);
  } catch (error) {
    console.error('[Videos API] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    } satisfies VideoResponse);
  }
}

// =============================================================================
// HANDLER FUNCTIONS
// =============================================================================

async function handleGetVideoById(
  loom_video_id: string,
  res: VercelResponse
): Promise<VercelResponse> {
  const persisted = await getVideoByLoomId(loom_video_id);

  if (!persisted) {
    return res.status(404).json({
      success: false,
      error: 'Video not found',
    } satisfies VideoResponse);
  }

  // Transform persisted video to API response format
  const video = transformToLoomVideo(persisted);

  return res.status(200).json({
    success: true,
    data: video,
  } satisfies VideoResponse);
}

async function handleGetVideosBySource(
  source_id: string,
  res: VercelResponse
): Promise<VercelResponse> {
  const persisted_videos = await getVideosBySourceId(source_id);

  const videos = persisted_videos.map(transformToLoomVideo);

  return res.status(200).json({
    success: true,
    data: videos,
    total: videos.length,
  } satisfies VideoResponse);
}

async function handleListVideos(
  limit: number,
  offset: number,
  res: VercelResponse
): Promise<VercelResponse> {
  const { videos: persisted_videos, total } = await getVideos(limit, offset);

  const videos = persisted_videos.map(transformToLoomVideo);

  return res.status(200).json({
    success: true,
    data: videos,
    total,
  } satisfies VideoResponse);
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Transform persisted video from database to API response format
 * This maintains compatibility with the original Loom video format
 */
function transformToLoomVideo(persisted: {
  loom_video_id: string;
  title: string;
  duration: number;
  thumbnail: string | null;
  description: string | null;
  owner_name: string | null;
  owner_avatar_url: string | null;
  loom_created_at: string | null;
  reactions: unknown;
  comments: unknown;
  transcript: unknown;
  chapters: unknown;
  tags: unknown;
}): LoomVideo {
  return {
    id: persisted.loom_video_id,
    title: persisted.title,
    duration: persisted.duration,
    thumbnail: persisted.thumbnail,
    description: persisted.description,
    owner_name: persisted.owner_name,
    owner_avatar_url: persisted.owner_avatar_url,
    created_at: persisted.loom_created_at,
    reactions: (persisted.reactions as LoomVideo['reactions']) || [],
    comments: (persisted.comments as LoomVideo['comments']) || [],
    transcript: (persisted.transcript as LoomVideo['transcript']) || null,
    chapters: (persisted.chapters as LoomVideo['chapters']) || null,
    tags: (persisted.tags as string[]) || [],
  };
}
