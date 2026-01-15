import { Client } from '@upstash/qstash';

// =============================================================================
// QSTASH CLIENT
// =============================================================================

/**
 * Get QStash client using environment variables
 */
function getClient(): Client {
  const token = process.env.QSTASH_TOKEN;

  if (!token) {
    throw new Error('QSTASH_TOKEN environment variable is not set');
  }

  return new Client({ token });
}

/**
 * Get base URL for webhooks
 */
function getBaseUrl(): string {
  return process.env.QSTASH_WEBHOOK_URL || 'http://localhost:3000';
}

// =============================================================================
// JOB PUBLISHING
// =============================================================================

export interface VideoJobPayload {
  loom_video_id: string;
  source_id: string | null;
  cookies: string | null;
}

export interface FolderJobPayload {
  folder_id: string;
  source_id: string;
  cookies: string | null;
  offset?: number; // For pagination/chaining
  video_ids?: string[]; // Pre-fetched video IDs to process
}

// Timeout for video scraping (in seconds) - scraping can take a while
const VIDEO_TIMEOUT = '30s';
const FOLDER_TIMEOUT = '60s';

/**
 * Publish a single video job to QStash
 */
export async function publishVideoJob(payload: VideoJobPayload): Promise<string> {
  const client = getClient();
  const url = `${getBaseUrl()}/api/worker/video`;

  const result = await client.publishJSON({
    url,
    body: payload,
    retries: 3,
    timeout: VIDEO_TIMEOUT,
  });

  return result.messageId;
}

/**
 * Publish a folder job to QStash
 * The folder worker will expand this into individual video jobs
 */
export async function publishFolderJob(payload: FolderJobPayload): Promise<string> {
  const client = getClient();
  const url = `${getBaseUrl()}/api/worker/folder`;

  const result = await client.publishJSON({
    url,
    body: payload,
    retries: 3,
    timeout: FOLDER_TIMEOUT,
  });

  return result.messageId;
}


// =============================================================================
// SIGNATURE VERIFICATION
// =============================================================================

import { Receiver } from '@upstash/qstash';

/**
 * Verify that a request came from QStash
 * Use this in the worker endpoint to ensure authenticity
 */
export async function verifyQStashSignature(
  signature: string | undefined,
  body: string
): Promise<boolean> {
  const current_key = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next_key = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (!current_key || !next_key) {
    console.warn('[QStash] Signing keys not configured, skipping verification');
    return true; // Allow in development
  }

  if (!signature) {
    console.error('[QStash] No signature provided');
    return false;
  }

  const receiver = new Receiver({
    currentSigningKey: current_key,
    nextSigningKey: next_key,
  });

  try {
    await receiver.verify({
      signature,
      body,
    });
    return true;
  } catch (error) {
    console.error('[QStash] Signature verification failed:', error);
    return false;
  }
}
