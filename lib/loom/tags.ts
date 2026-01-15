import { graphqlClient } from './client.js';
import { GRAPHQL_QUERIES } from './queries.js';

// =============================================================================
// GRAPHQL RESPONSE TYPES
// =============================================================================

interface GetTagsResponse {
  result: {
    tags?: string[];
    __typename: string;
  } | null;
}

// =============================================================================
// TAGS FETCHER
// =============================================================================

/**
 * Fetch tags for a video using GraphQL
 * Note: Tags require authentication - cookies must be provided
 */
export async function fetchVideoTags(video_id: string, cookies?: string): Promise<string[]> {
  // Tags require authentication
  if (!cookies) {
    return [];
  }

  try {
    const response = await graphqlClient<GetTagsResponse>(
      {
        operationName: 'GetTagsByVideoId',
        query: GRAPHQL_QUERIES.GET_TAGS,
        variables: { videoId: video_id },
      },
      { cookies }
    );

    const tags = response?.result?.tags || [];
    if (tags.length > 0) {
      console.log(`[Tags] Found ${tags.length} tags for: ${video_id}`);
    }

    return tags;
  } catch (error) {
    console.error('[Tags] Error:', error);
    return [];
  }
}
