// =============================================================================
// LOOM MODULE EXPORTS
// =============================================================================

// Main scraper
export { scrapeVideo } from './scraper.js';

// Individual services
export { fetchVideoMetadata } from './video.js';
export { fetchChapters } from './chapters.js';
export { fetchVideoComments } from './comments.js';
export { fetchVideoReactions } from './reactions.js';
export { fetchTranscriptFromCdn } from './transcript.js';
export { fetchVideoTags } from './tags.js';
export { fetchFolderVideos } from './folder.js';

// Utilities
export { extractVideoId, extractFolderId, parseCookies, createHeaders } from './utils.js';

// GraphQL client
export { graphqlClient, graphqlClientWithAuth } from './client.js';

// Queries (for reference/debugging)
export { GRAPHQL_QUERIES } from './queries.js';
