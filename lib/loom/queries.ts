// =============================================================================
// GRAPHQL QUERIES - Loom API queries migrated from Supabase Edge Functions
// =============================================================================

export const GRAPHQL_QUERIES = {
  /**
   * Fetches basic video metadata including owner info and creation date
   */
  GET_VIDEO: `
    query GetVideo($id: ID!, $password: String = null) {
      getVideo(id: $id, password: $password) {
        ... on RegularUserVideo {
          owner {
            id
            first_name
            last_name
            __typename
          }
          createdAt
          name
          __typename
        }
        __typename
      }
    }
  `,

  /**
   * Fetches video chapters (time-stamped sections)
   */
  FETCH_CHAPTERS: `
    query FetchChapters($videoId: ID!, $password: String) {
      fetchVideoChapters(videoId: $videoId, password: $password) {
        ... on VideoChapters {
          id
          video_id
          content
          schema_version
          updatedAt
          edited_at
          auto_chapter_status
          __typename
        }
        ... on EmptyChaptersPayload {
          content
          __typename
        }
        ... on InvalidRequestWarning {
          message
          __typename
        }
        ... on Error {
          message
          __typename
        }
        __typename
      }
    }
  `,

  /**
   * Fetches all comments and replies on a video
   */
  FETCH_COMMENTS: `
    query fetchVideoComments($id: ID!, $password: String) {
      video: getVideo(id: $id, password: $password) {
        __typename
        ... on RegularUserVideo {
          id
          video_comments(includeDeleted: true) {
            ...CommentPostFragment
            __typename
          }
          __typename
        }
      }
    }

    fragment CommentPostFragment on PublicVideoComment {
      id
      content(withMentionMarkups: true)
      plainContent: content(withMentionMarkups: false)
      time_stamp(password: $password)
      user_name
      avatar {
        name
        thumb
        isAtlassianMastered
        __typename
      }
      edited
      createdAt
      isChatMessage
      user_id
      anon_user_id
      deletedAt
      guid
      children_comments {
        ...CommentReplyFragment
        __typename
      }
      __typename
    }

    fragment CommentReplyFragment on PublicVideoComment {
      id
      content(withMentionMarkups: true)
      plainContent: content(withMentionMarkups: false)
      time_stamp(password: $password)
      user_name
      avatar {
        name
        thumb
        isAtlassianMastered
        __typename
      }
      edited
      user_id
      anon_user_id
      createdAt
      isChatMessage
      comment_post_idv2
      extended_reaction
      guid
      __typename
    }
  `,

  /**
   * Fetches emoji reactions on a video
   */
  FETCH_REACTIONS: `
    query fetchVideoReactions($id: ID!, $password: String) {
      videoReactionsForVideo(videoId: $id, password: $password) {
        __typename
        ... on VideoReactionsSuccessPayload {
          reactions {
            ...VideoPlayerReactionFragment
            __typename
          }
          __typename
        }
        ... on InvalidRequestWarning {
          message
          __typename
        }
        ... on GenericError {
          message
          __typename
        }
      }
    }

    fragment VideoPlayerReactionFragment on PublicVideoReaction {
      id
      time
      user {
        id
        display_name
        __typename
      }
      reaction
      extended_reaction
      anon_user_id
      anon_user_name
      __typename
    }
  `,

  /**
   * Fetches videos in a folder with pagination support
   * Requires authentication (cookies)
   */
  GET_LOOMS_FOR_LIBRARY: `
    query GetLoomsForLibrary(
      $limit: Int!
      $cursor: String
      $folderId: String
      $sourceValue: String
      $source: LoomsSource!
      $sortType: LoomsSortType!
      $sortOrder: LoomsSortOrder!
      $sortGrouping: LoomsSortGrouping
      $filters: [[LoomsCollectionFilter!]!]
      $timeRange: TimeRange
    ) {
      getLooms {
        __typename
        ... on GetLoomsPayload {
          videos(
            first: $limit
            after: $cursor
            folderId: $folderId
            sourceValue: $sourceValue
            source: $source
            sortType: $sortType
            sortOrder: $sortOrder
            sortGrouping: $sortGrouping
            filters: $filters
            timeRange: $timeRange
          ) {
            edges {
              cursor
              node {
                id
                name
                visibility
                __typename
              }
              __typename
            }
            pageInfo {
              endCursor
              hasNextPage
              __typename
            }
            __typename
          }
          __typename
        }
      }
    }
  `,

  /**
   * Fetches tags assigned to a video
   * Requires authentication (cookies)
   */
  GET_TAGS: `
    query GetTagsByVideoId($videoId: ID!) {
      result: getTagsByVideoId(videoId: $videoId) {
        ... on GetTagsByVideoIdPayload {
          tags
          __typename
        }
        __typename
      }
    }
  `,
} as const;
