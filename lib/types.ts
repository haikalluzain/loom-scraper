// =============================================================================
// VIDEO DATA TYPES - Core data structures for scraped Loom videos
// =============================================================================

export interface CommentReply {
  id: string;
  author: string;
  content: string;
  video_timestamp: number | null;
  avatar_url: string | null;
  created_at: string;
  edited: boolean;
}

export interface LoomComment {
  id: string;
  author: string;
  content: string;
  video_timestamp: number | null;
  avatar_url: string | null;
  created_at: string;
  edited: boolean;
  replies: CommentReply[];
}

export interface TranscriptSegment {
  ts: number;
  value: string;
}

export interface Chapter {
  timestamp: string;
  title: string;
  start_seconds: number;
}

export interface Reaction {
  id: string;
  video_timestamp: number;
  user_name: string;
  reaction: string;
}

export interface LoomVideo {
  id: string;
  title: string;
  duration: number;
  thumbnail: string | null;
  description: string | null;
  reactions: Reaction[];
  comments: LoomComment[];
  transcript: TranscriptSegment[] | null;
  chapters: Chapter[] | null;
  tags: string[];
  created_at: string | null;
  owner_name: string | null;
  owner_avatar_url: string | null;
}

// =============================================================================
// DATABASE TYPES - Shapes for Neon Postgres persistence
// =============================================================================

export type ScrapeStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type JobType = 'video' | 'folder';

/**
 * Represents a folder or single video to be scraped
 * Folders are expanded into individual video jobs
 */
export interface ScrapeSource {
  id: string;
  url: string;
  type: JobType;
  cookies: string | null;
  status: ScrapeStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Individual video scrape job in the queue
 * Each video is processed independently to avoid timeouts
 */
export interface VideoJob {
  id: string;
  source_id: string | null;
  loom_video_id: string;
  status: ScrapeStatus;
  attempt_count: number;
  max_attempts: number;
  error_message: string | null;
  cookies: string | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

/**
 * Persisted video data after successful scrape
 * This is the source of truth for scraped Loom data
 */
export interface PersistedVideo {
  id: string;
  loom_video_id: string;
  title: string;
  duration: number;
  thumbnail: string | null;
  description: string | null;
  owner_name: string | null;
  owner_avatar_url: string | null;
  loom_created_at: string | null;
  reactions: Reaction[];
  comments: LoomComment[];
  transcript: TranscriptSegment[] | null;
  chapters: Chapter[] | null;
  tags: string[];
  raw_data: LoomVideo;
  scraped_at: string;
  updated_at: string;
}

// =============================================================================
// GRAPHQL TYPES - Request/response shapes for Loom's GraphQL API
// =============================================================================

export interface GraphQLRequest {
  operationName: string;
  query: string;
  variables: Record<string, unknown>;
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    path?: string[];
  }>;
}

export interface VideoMetadata {
  created_at: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  name: string | null;
}

// =============================================================================
// API TYPES - Request/response shapes for our API endpoints
// =============================================================================

export interface EnqueueRequest {
  url: string;
  type: JobType;
  cookies?: string | object[];
}

export interface EnqueueResponse {
  success: boolean;
  source_id?: string;
  jobs_created?: number;
  error?: string;
}

export interface VideoResponse {
  success: boolean;
  data?: LoomVideo | LoomVideo[];
  total?: number;
  error?: string;
}

export interface WorkerResponse {
  success: boolean;
  video_id?: string;
  error?: string;
}

export interface CronResponse {
  success: boolean;
  jobs_processed?: number;
  errors?: string[];
}

// =============================================================================
// QUEUE TYPES - Redis queue message shapes
// =============================================================================

export interface QueuedJob {
  job_id: string;
  loom_video_id: string;
  source_id: string | null;
  cookies: string | null;
  enqueued_at: string;
}

// =============================================================================
// FOLDER TYPES - For folder listing operations
// =============================================================================

export interface FolderVideo {
  id: string;
  name: string;
  visibility: string;
}

export interface FolderResult {
  success: boolean;
  folder_id?: string;
  videos?: FolderVideo[];
  total_count?: number;
  error?: string;
}
