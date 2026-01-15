import type { LoomVideo, TranscriptSegment } from '../types.js';
import { createHeaders } from './utils.js';
import { fetchVideoMetadata } from './video.js';
import { fetchChapters } from './chapters.js';
import { fetchVideoComments } from './comments.js';
import { fetchVideoReactions } from './reactions.js';
import { fetchTranscriptFromCdn } from './transcript.js';
import { fetchVideoTags } from './tags.js';

// =============================================================================
// MAIN VIDEO SCRAPER
// =============================================================================

/**
 * Scrapes complete metadata for a single Loom video
 *
 * This is the main entry point for scraping a video.
 * It fetches data from multiple sources in parallel:
 * - OEmbed API for basic info
 * - Video page HTML for title, description, thumbnail
 * - GraphQL API for metadata, chapters, comments, reactions
 * - CDN for transcript
 *
 * @param video_id - The Loom video ID to scrape
 * @param cookies - Optional authentication cookies for private videos
 * @returns Complete video data or null if scraping failed
 */
export async function scrapeVideo(video_id: string, cookies?: string): Promise<LoomVideo | null> {
  console.log(`[Scraper] Starting scrape for video: ${video_id}`);

  const headers = createHeaders(cookies);

  try {
    // Step 1: Fetch basic info from OEmbed (public videos)
    let title = 'Untitled Video';
    let thumbnail: string | null = null;
    let owner_name: string | null = null;
    let duration = 0;

    try {
      const oembed_url = `https://www.loom.com/v1/oembed?url=https://www.loom.com/share/${video_id}`;
      const oembed_response = await fetch(oembed_url, { headers });

      if (oembed_response.ok) {
        const oembed_data = (await oembed_response.json()) as {
          title?: string;
          thumbnail_url?: string;
          author_name?: string;
          duration?: number;
        };
        title = oembed_data.title || title;
        thumbnail = oembed_data.thumbnail_url || null;
        owner_name = oembed_data.author_name || null;
        duration = oembed_data.duration || 0;
      }
    } catch (e) {
      console.log(`[Scraper] OEmbed fetch failed, continuing...`);
    }

    // Step 2: Fetch video page for additional data
    let description: string | null = null;

    try {
      const page_url = `https://www.loom.com/share/${video_id}`;
      const page_response = await fetch(page_url, { headers });

      if (page_response.ok) {
        const html = await page_response.text();

        // Extract JSON data from the page
        const app_state_match = html.match(
          /<script[^>]*id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/
        );
        if (app_state_match) {
          try {
            const next_data = JSON.parse(app_state_match[1]);
            const video_data =
              next_data?.props?.pageProps?.video || next_data?.props?.pageProps?.sharedVideo;

            if (video_data) {
              title = video_data.name || video_data.title || title;
              description = video_data.description || null;
              duration = video_data.duration || duration;
              thumbnail = video_data.thumbnailUrl || video_data.thumbnail_url || thumbnail;
            }
          } catch {
            console.log('[Scraper] Could not parse NEXT_DATA JSON');
          }
        }

        // Extract meta tags as fallback
        if (title === 'Untitled Video') {
          const og_title_match = html.match(
            /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/
          );
          if (og_title_match) {
            title = og_title_match[1];
          }
        }

        if (!description) {
          const og_desc_match = html.match(
            /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/
          );
          if (og_desc_match) {
            description = og_desc_match[1];
          }
        }

        if (!thumbnail) {
          const og_image_match = html.match(
            /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/
          );
          if (og_image_match) {
            thumbnail = og_image_match[1];
          }
        }
      }
    } catch (e) {
      console.log('[Scraper] Page fetch failed, continuing with available data...');
    }

    // Step 3: Fetch additional data in parallel for better performance
    // This is safe to do in parallel as these are independent API calls
    const [transcript_result, video_metadata, chapters, comments, reactions, tags] =
      await Promise.all([
        fetchTranscriptFromCdn(video_id, cookies),
        fetchVideoMetadata(video_id),
        fetchChapters(video_id),
        fetchVideoComments(video_id),
        fetchVideoReactions(video_id),
        fetchVideoTags(video_id, cookies),
      ]);

    const transcript: TranscriptSegment[] | null = transcript_result;

    // Step 4: Merge GraphQL data with page data
    const created_at = video_metadata?.created_at || new Date().toISOString();
    if (video_metadata?.owner_first_name || video_metadata?.owner_last_name) {
      owner_name =
        [video_metadata.owner_first_name, video_metadata.owner_last_name]
          .filter(Boolean)
          .join(' ') || owner_name;
    }
    if (video_metadata?.name && title === 'Untitled Video') {
      title = video_metadata.name;
    }

    // Step 5: Build final video object
    const video_result: LoomVideo = {
      id: video_id,
      title,
      duration,
      thumbnail,
      description,
      reactions: reactions || [],
      comments: comments || [],
      transcript,
      chapters,
      tags: tags || [],
      created_at,
      owner_name: owner_name || null,
      owner_avatar_url: null,
    };

    console.log(`[Scraper] Successfully scraped video: ${video_id} - "${title}"`);
    return video_result;
  } catch (error) {
    console.error(`[Scraper] Error scraping video ${video_id}:`, error);
    return null;
  }
}
