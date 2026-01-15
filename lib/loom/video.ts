import { graphqlClient } from './client.js';
import { GRAPHQL_QUERIES } from './queries.js';
import type { VideoMetadata } from '../types.js';

// =============================================================================
// GRAPHQL RESPONSE TYPES
// =============================================================================

interface GetVideoResponse {
  getVideo: {
    owner?: {
      id: string;
      first_name: string;
      last_name: string;
    };
    createdAt?: string;
    name?: string;
  };
}

// =============================================================================
// VIDEO METADATA FETCHER
// =============================================================================

/**
 * Fetch video metadata from Loom's GraphQL API
 * Returns: createdAt, owner info, video name
 */
export async function fetchVideoMetadata(video_id: string): Promise<VideoMetadata | null> {
  const data = await graphqlClient<GetVideoResponse>({
    operationName: 'GetVideo',
    query: GRAPHQL_QUERIES.GET_VIDEO,
    variables: { id: video_id, password: null },
  });

  if (!data?.getVideo) {
    console.log(`[Video] No metadata found for: ${video_id}`);
    return null;
  }

  const video = data.getVideo;

  return {
    created_at: video.createdAt || null,
    owner_first_name: video.owner?.first_name || null,
    owner_last_name: video.owner?.last_name || null,
    name: video.name || null,
  };
}
