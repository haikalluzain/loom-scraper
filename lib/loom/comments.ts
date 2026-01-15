import { graphqlClient } from './client.js';
import { GRAPHQL_QUERIES } from './queries.js';
import type { LoomComment, CommentReply } from '../types.js';

// =============================================================================
// GRAPHQL RESPONSE TYPES
// =============================================================================

interface Avatar {
  name: string;
  thumb: string;
  isAtlassianMastered: boolean | null;
}

interface GraphQLComment {
  id: string;
  content: string;
  plainContent: string;
  time_stamp: number | null;
  user_name: string;
  avatar: Avatar | null;
  edited: boolean;
  createdAt: string;
  isChatMessage: boolean;
  user_id: number | null;
  anon_user_id: string | null;
  deletedAt: string | null;
  guid: string;
  children_comments: GraphQLComment[];
}

interface FetchCommentsResponse {
  video: {
    __typename: string;
    id?: string;
    video_comments?: GraphQLComment[];
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const LOOM_AVATAR_BASE_URL = 'https://cdn.loom.com/';

function buildAvatarUrl(avatar: Avatar | null): string | null {
  if (!avatar?.thumb) return null;
  return `${LOOM_AVATAR_BASE_URL}${avatar.thumb}`;
}

function mapCommentReply(reply: GraphQLComment): CommentReply {
  return {
    id: reply.id,
    author: reply.user_name || 'Anonymous',
    content: reply.plainContent || reply.content || '',
    video_timestamp: reply.time_stamp,
    avatar_url: buildAvatarUrl(reply.avatar),
    created_at: reply.createdAt,
    edited: reply.edited || false,
  };
}

function mapComment(comment: GraphQLComment): LoomComment {
  return {
    id: comment.id,
    author: comment.user_name || 'Anonymous',
    content: comment.plainContent || comment.content || '',
    video_timestamp: comment.time_stamp,
    avatar_url: buildAvatarUrl(comment.avatar),
    created_at: comment.createdAt,
    edited: comment.edited || false,
    replies: (comment.children_comments || [])
      .filter((reply) => !reply.deletedAt)
      .map(mapCommentReply),
  };
}

// =============================================================================
// COMMENTS FETCHER
// =============================================================================

/**
 * Fetch video comments from Loom's GraphQL API
 */
export async function fetchVideoComments(video_id: string): Promise<LoomComment[] | null> {
  console.log(`[Comments] Fetching for: ${video_id}`);

  const data = await graphqlClient<FetchCommentsResponse>({
    operationName: 'fetchVideoComments',
    query: GRAPHQL_QUERIES.FETCH_COMMENTS,
    variables: { id: video_id, password: null },
  });

  if (!data?.video) {
    console.log('[Comments] No video data in response');
    return null;
  }

  const video_comments = data.video.video_comments;

  if (!video_comments || video_comments.length === 0) {
    return [];
  }

  // Filter out deleted comments and map to our format
  const comments = video_comments.filter((comment) => !comment.deletedAt).map(mapComment);

  console.log(`[Comments] Found ${comments.length} comments`);
  return comments;
}
