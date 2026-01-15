import { graphqlClient } from './client.js';
import { GRAPHQL_QUERIES } from './queries.js';
import type { Reaction } from '../types.js';
import * as emoji from 'node-emoji';

// =============================================================================
// GRAPHQL RESPONSE TYPES
// =============================================================================

interface GraphQLReaction {
  id: string;
  time: number;
  user: {
    id: string;
    display_name: string;
  } | null;
  reaction: number;
  extended_reaction: string | null;
  anon_user_id: string | null;
  anon_user_name: string | null;
}

interface FetchReactionsResponse {
  videoReactionsForVideo: {
    __typename: string;
    reactions?: GraphQLReaction[];
    message?: string;
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Fallback mapping for numeric reaction codes
const REACTION_CODE_MAP: Record<number, string> = {
  1: 'joy',
  2: 'heart_eyes',
  3: 'open_mouth',
  4: 'raised_hands',
  5: '+1',
  6: '-1',
};

function getReactionEmoji(extended_reaction: string | null, reaction: number): string {
  const emoji_name = extended_reaction || REACTION_CODE_MAP[reaction] || 'thumbsup';
  return emoji.get(emoji_name) || emoji_name;
}

function mapReaction(graphql_reaction: GraphQLReaction): Reaction {
  const user_name =
    graphql_reaction.user?.display_name || graphql_reaction.anon_user_name || 'Anonymous';

  return {
    id: graphql_reaction.id,
    video_timestamp: graphql_reaction.time,
    user_name,
    reaction: getReactionEmoji(graphql_reaction.extended_reaction, graphql_reaction.reaction),
  };
}

// =============================================================================
// REACTIONS FETCHER
// =============================================================================

/**
 * Fetch video reactions from Loom's GraphQL API
 */
export async function fetchVideoReactions(video_id: string): Promise<Reaction[] | null> {
  console.log(`[Reactions] Fetching for: ${video_id}`);

  const data = await graphqlClient<FetchReactionsResponse>({
    operationName: 'fetchVideoReactions',
    query: GRAPHQL_QUERIES.FETCH_REACTIONS,
    variables: { id: video_id, password: null },
  });

  if (!data?.videoReactionsForVideo) {
    return null;
  }

  const reactions_data = data.videoReactionsForVideo;

  // Handle error responses
  if (
    reactions_data.__typename === 'InvalidRequestWarning' ||
    reactions_data.__typename === 'GenericError'
  ) {
    console.log(`[Reactions] Error: ${reactions_data.message}`);
    return null;
  }

  if (!reactions_data.reactions || reactions_data.reactions.length === 0) {
    return [];
  }

  const reactions = reactions_data.reactions.map(mapReaction);
  console.log(`[Reactions] Found ${reactions.length} reactions`);

  return reactions;
}
