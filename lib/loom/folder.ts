import { GRAPHQL_QUERIES } from './queries.js';
import { graphqlClientWithAuth } from './client.js';
import { parseCookies } from './utils.js';
import type { FolderVideo, FolderResult } from '../types.js';

// =============================================================================
// GRAPHQL RESPONSE TYPES
// =============================================================================

interface VideoEdge {
  cursor: string;
  node: {
    id: string;
    name: string;
    visibility: string;
  };
}

interface PageInfo {
  endCursor: string | null;
  hasNextPage: boolean;
}

interface GetLoomsResponse {
  getLooms: {
    __typename: string;
    videos?: {
      edges: VideoEdge[];
      pageInfo: PageInfo;
    };
  };
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_PAGE_SIZE = 50; // Fetch 50 videos per request
const MAX_VIDEOS = 500; // Safety limit to prevent infinite loops

// =============================================================================
// PAGINATION HELPER
// =============================================================================

interface FetchPageResult {
  videos: FolderVideo[];
  end_cursor: string | null;
  has_next_page: boolean;
  error?: string;
}

async function fetchVideosPage(
  folder_id: string,
  cookie_string: string,
  cursor: string | null
): Promise<FetchPageResult | null> {
  const variables = {
    source: 'MINE',
    sourceValue: folder_id,
    folderId: folder_id,
    sortType: 'RECENT',
    sortOrder: 'DESC',
    filters: [],
    limit: DEFAULT_PAGE_SIZE,
    cursor: cursor,
    timeRange: null,
  };

  const result = await graphqlClientWithAuth<GetLoomsResponse>(
    GRAPHQL_QUERIES.GET_LOOMS_FOR_LIBRARY,
    'GetLoomsForLibrary',
    variables,
    cookie_string
  );

  if (result.error) {
    return { videos: [], end_cursor: null, has_next_page: false, error: result.error };
  }

  if (!result.data?.getLooms) {
    return {
      videos: [],
      end_cursor: null,
      has_next_page: false,
      error: 'No getLooms data in response',
    };
  }

  const get_looms = result.data.getLooms;

  if (!get_looms.videos) {
    return {
      videos: [],
      end_cursor: null,
      has_next_page: false,
      error: 'No videos in response - folder may be empty or inaccessible',
    };
  }

  const { edges, pageInfo } = get_looms.videos;

  const videos: FolderVideo[] = edges.map((edge) => ({
    id: edge.node.id,
    name: edge.node.name,
    visibility: edge.node.visibility,
  }));

  return {
    videos,
    end_cursor: pageInfo.endCursor,
    has_next_page: pageInfo.hasNextPage,
  };
}

// =============================================================================
// FOLDER VIDEO LISTING
// =============================================================================

/**
 * Fetch all videos from a Loom folder using authenticated GraphQL with pagination
 *
 * IMPORTANT: This function only lists video IDs in the folder.
 * Each video should be scraped independently via the worker queue
 * to avoid timeouts.
 */
export async function fetchFolderVideos(
  folder_id: string,
  cookies: string | undefined
): Promise<FolderResult> {
  console.log(`[Folder] Fetching videos for folder: ${folder_id}`);

  // Parse cookies to get cookie string
  const cookie_string = parseCookies(cookies);

  if (!cookie_string) {
    return {
      success: false,
      error: 'Cookies are required to access folder contents. Please provide valid session cookies.',
    };
  }

  const all_videos: FolderVideo[] = [];
  let cursor: string | null = null;
  let has_next_page = true;
  let page_count = 0;
  let last_error: string | undefined;

  // Paginate through all videos
  while (has_next_page && all_videos.length < MAX_VIDEOS) {
    page_count++;
    console.log(`[Folder] Fetching page ${page_count}, cursor: ${cursor || 'initial'}`);

    const page_result: FetchPageResult | null = await fetchVideosPage(folder_id, cookie_string, cursor);

    if (!page_result || page_result.error) {
      last_error = page_result?.error || 'Unknown error';

      // If first page fails, return error with details
      if (page_count === 1) {
        return {
          success: false,
          error: `Failed to fetch folder videos: ${last_error}`,
        };
      }
      // If subsequent page fails, return what we have
      console.log(`[Folder] Error on page ${page_count}: ${last_error}, returning partial results`);
      break;
    }

    all_videos.push(...page_result.videos);
    cursor = page_result.end_cursor;
    has_next_page = page_result.has_next_page;
  }

  console.log(`[Folder] Total videos found: ${all_videos.length}`);

  return {
    success: true,
    folder_id,
    videos: all_videos,
    total_count: all_videos.length,
  };
}
