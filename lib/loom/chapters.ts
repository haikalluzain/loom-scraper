import { graphqlClient } from './client.js';
import { GRAPHQL_QUERIES } from './queries.js';
import { timestampToSeconds } from './utils.js';
import type { Chapter } from '../types.js';

// =============================================================================
// GRAPHQL RESPONSE TYPES
// =============================================================================

interface FetchChaptersResponse {
  fetchVideoChapters: {
    __typename: string;
    content?: string;
    message?: string;
    updatedAt?: string;
  };
}

// =============================================================================
// CHAPTERS FETCHER
// =============================================================================

/**
 * Fetch video chapters from Loom's GraphQL API
 */
export async function fetchChapters(video_id: string): Promise<Chapter[] | null> {
  console.log(`[Chapters] Fetching for: ${video_id}`);

  const data = await graphqlClient<FetchChaptersResponse>({
    operationName: 'FetchChapters',
    query: GRAPHQL_QUERIES.FETCH_CHAPTERS,
    variables: { videoId: video_id, password: null },
  });

  if (!data?.fetchVideoChapters) {
    console.log('[Chapters] No data in response');
    return null;
  }

  const chapters_data = data.fetchVideoChapters;

  // Handle different response types
  if (
    chapters_data.__typename === 'Error' ||
    chapters_data.__typename === 'InvalidRequestWarning'
  ) {
    console.log(`[Chapters] Error: ${chapters_data.message}`);
    return null;
  }

  if (chapters_data.__typename === 'EmptyChaptersPayload' || !chapters_data.content) {
    console.log('[Chapters] No chapters available');
    return null;
  }

  // Parse chapters content
  return parseChaptersContent(chapters_data.content);
}

/**
 * Parse chapters content string into Chapter array
 * Format: "00:00 Introduction\n01:20 Creating a custom app\n..."
 */
function parseChaptersContent(content: string): Chapter[] {
  const lines = content.split('\n').filter((line) => line.trim());

  return lines
    .map((line) => {
      // Match timestamp at the beginning (e.g., "00:00", "01:20", "1:05:30")
      const match = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);

      if (!match) {
        return null;
      }

      const [, timestamp, title] = match;
      const start_seconds = timestampToSeconds(timestamp);

      return {
        timestamp,
        title: title.trim(),
        start_seconds,
      };
    })
    .filter((chapter): chapter is Chapter => chapter !== null);
}
