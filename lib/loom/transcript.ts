import type { TranscriptSegment } from '../types.js';
import { parseCookies } from './utils.js';

// =============================================================================
// TRANSCRIPT FETCHER - Fetches transcript from Loom CDN
// =============================================================================

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Fetch transcript from CDN using signed URL from page data
 */
export async function fetchTranscriptFromCdn(
  video_id: string,
  cookies?: string
): Promise<TranscriptSegment[] | null> {
  console.log(`[Transcript] Fetching for: ${video_id}`);

  const headers: Record<string, string> = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'User-Agent': DEFAULT_USER_AGENT,
  };

  const cookie_string = parseCookies(cookies);
  if (cookie_string) {
    headers['Cookie'] = cookie_string;
  }

  try {
    // Fetch the video page to get the signed CDN URL
    const page_url = `https://www.loom.com/share/${video_id}`;
    const page_response = await fetch(page_url, { headers });

    if (!page_response.ok) {
      console.log(`[Transcript] Page fetch failed: ${page_response.status}`);
      return null;
    }

    const html = await page_response.text();

    // Look for the CDN transcript URL in __NEXT_DATA__
    const next_data_match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);

    if (next_data_match) {
      try {
        const next_data = JSON.parse(next_data_match[1]);
        const transcript_url = findTranscriptUrl(next_data);

        if (transcript_url) {
          console.log(`[Transcript] Found CDN URL`);

          // Fetch the transcript JSON from CDN
          const transcript_response = await fetch(transcript_url, {
            headers: {
              Accept: 'application/json',
              'User-Agent': DEFAULT_USER_AGENT,
            },
          });

          if (transcript_response.ok) {
            const transcript_data = await transcript_response.json();
            return parseTranscriptData(transcript_data);
          } else {
            console.log(`[Transcript] CDN fetch failed: ${transcript_response.status}`);
          }
        }
      } catch (e) {
        console.log('[Transcript] Error parsing NEXT_DATA:', e);
      }
    }

    // Fallback: Look for transcript URL directly in HTML
    const cdn_url_match = html.match(
      /https:\/\/cdn\.loom\.com\/mediametadata\/transcription\/[^"'\s]+/
    );
    if (cdn_url_match) {
      console.log('[Transcript] Found CDN URL in HTML fallback');
      const transcript_response = await fetch(cdn_url_match[0], {
        headers: { Accept: 'application/json' },
      });

      if (transcript_response.ok) {
        const transcript_data = await transcript_response.json();
        return parseTranscriptData(transcript_data);
      }
    }

    console.log('[Transcript] No transcript found');
    return null;
  } catch (error) {
    console.error('[Transcript] Error:', error);
    return null;
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Recursively search for transcript URL in nested object
 */
function findTranscriptUrl(obj: unknown, depth = 0): string | null {
  if (depth > 10 || !obj) return null;

  if (typeof obj === 'string') {
    if (obj.includes('cdn.loom.com/mediametadata/transcription')) {
      return obj;
    }
    return null;
  }

  if (typeof obj === 'object' && obj !== null) {
    const record = obj as Record<string, unknown>;

    // Check common property names first
    const url_props = [
      'transcription_url',
      'transcriptUrl',
      'transcript_url',
      'transcriptionUrl',
      'url',
    ];
    for (const prop of url_props) {
      const value = record[prop];
      if (value && typeof value === 'string' && value.includes('cdn.loom.com')) {
        return value;
      }
    }

    // Search all properties
    for (const key of Object.keys(record)) {
      const result = findTranscriptUrl(record[key], depth + 1);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Parse transcript data from CDN JSON response
 * Handles multiple formats that Loom may return
 */
function parseTranscriptData(data: unknown): TranscriptSegment[] | null {
  if (!data || typeof data !== 'object') return null;

  const record = data as Record<string, unknown>;

  // Handle phrases format (Loom CDN format)
  // { "phrases": [{ "ts": 0.88, "value": "Hello...", "ranges": [...] }] }
  if (record.phrases && Array.isArray(record.phrases)) {
    const segments = record.phrases
      .filter((phrase: unknown) => {
        const p = phrase as Record<string, unknown>;
        return p && typeof p.value === 'string';
      })
      .map((phrase: unknown) => {
        const p = phrase as Record<string, unknown>;
        return {
          ts: typeof p.ts === 'number' ? p.ts : 0,
          value: p.value as string,
        };
      });
    if (segments.length > 0) {
      console.log(`[Transcript] Parsed ${segments.length} segments from phrases format`);
      return segments;
    }
  }

  // CDN format typically has segments with text and timing
  if (Array.isArray(data)) {
    const segments = data
      .filter((item: unknown) => {
        const i = item as Record<string, unknown>;
        return i && (i.text || i.value || i.transcript);
      })
      .map((item: unknown) => {
        const i = item as Record<string, unknown>;
        return {
          ts: (i.ts as number) || (i.start as number) || (i.timestamp as number) || 0,
          value: (i.text || i.value || i.transcript) as string,
        };
      });
    if (segments.length > 0) {
      console.log(`[Transcript] Parsed ${segments.length} segments from array format`);
      return segments;
    }
  }

  // Nested segments format
  if (record.segments && Array.isArray(record.segments)) {
    const segments = record.segments
      .filter((s: unknown) => {
        const seg = s as Record<string, unknown>;
        return seg && (seg.text || seg.value);
      })
      .map((s: unknown) => {
        const seg = s as Record<string, unknown>;
        return {
          ts: (seg.ts as number) || (seg.start as number) || (seg.timestamp as number) || 0,
          value: (seg.text || seg.value) as string,
        };
      });
    if (segments.length > 0) {
      console.log(`[Transcript] Parsed ${segments.length} segments from segments format`);
      return segments;
    }
  }

  // Transcripts array format
  if (record.transcripts && Array.isArray(record.transcripts)) {
    const segments = record.transcripts
      .filter((t: unknown) => {
        const tr = t as Record<string, unknown>;
        return tr && (tr.text || tr.value);
      })
      .map((t: unknown) => {
        const tr = t as Record<string, unknown>;
        return {
          ts: (tr.ts as number) || (tr.start as number) || (tr.timestamp as number) || 0,
          value: (tr.text || tr.value) as string,
        };
      });
    if (segments.length > 0) {
      console.log(`[Transcript] Parsed ${segments.length} segments from transcripts format`);
      return segments;
    }
  }

  // Single transcript string or object
  if (record.transcript) {
    if (typeof record.transcript === 'string') {
      return [{ ts: 0, value: record.transcript }];
    }
    if (Array.isArray(record.transcript)) {
      const segments = record.transcript
        .filter((t: unknown) => {
          const tr = t as Record<string, unknown>;
          return tr && (tr.text || tr.value);
        })
        .map((t: unknown) => {
          const tr = t as Record<string, unknown>;
          return {
            ts: (tr.ts as number) || (tr.start as number) || (tr.timestamp as number) || 0,
            value: (tr.text || tr.value) as string,
          };
        });
      if (segments.length > 0) {
        return segments;
      }
    }
  }

  // Plain text format
  if (record.text && typeof record.text === 'string') {
    return [{ ts: 0, value: record.text }];
  }

  console.log('[Transcript] Unknown data format');
  return null;
}
