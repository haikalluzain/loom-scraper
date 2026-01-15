// =============================================================================
// URL PARSING UTILITIES
// =============================================================================

/**
 * Extract video ID from various Loom URL formats
 * Supports: /share/, /v/, /embed/
 */
export function extractVideoId(url: string): string | null {
  const patterns = [
    /loom\.com\/share\/([a-zA-Z0-9]+)/,
    /loom\.com\/v\/([a-zA-Z0-9]+)/,
    /loom\.com\/embed\/([a-zA-Z0-9]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Extract folder ID from Loom folder URL
 * Supports formats:
 * - https://www.loom.com/spaces/folder-name-123abc
 * - https://www.loom.com/spaces/123abc
 * - https://www.loom.com/looms/folders/123abc
 * - https://www.loom.com/looms/videos/FolderName-123abc
 * - Direct folder ID
 */
export function extractFolderId(url: string): string | null {
  // If it's already just an ID (no URL)
  if (/^[a-f0-9]{32}$/i.test(url.trim())) {
    return url.trim();
  }

  const patterns = [
    // /spaces/folder-name-ID or /spaces/ID
    /loom\.com\/spaces\/(?:[^/?]+-)?([a-f0-9]{32})(?:\?|$|\/)/i,
    /loom\.com\/spaces\/([a-f0-9]{32})(?:\?|$|\/)/i,
    // /looms/folders/ID
    /loom\.com\/looms\/folders\/([a-f0-9]{32})/i,
    // /looms/videos/FolderName-ID
    /loom\.com\/looms\/videos\/[^/]+-([a-f0-9]{32})(?:\?|$|\/)?/i,
    /loom\.com\/looms\/videos\/([a-f0-9]{32})(?:\?|$|\/)?/i,
    // Query param: folderId=ID
    /folderId[=:]([a-f0-9]{32})/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  // Fallback: Try to extract any 32-character hex string from the URL
  const hexMatch = url.match(/([a-f0-9]{32})/i);
  if (hexMatch) {
    return hexMatch[1];
  }

  return null;
}

// =============================================================================
// TIME UTILITIES
// =============================================================================

/**
 * Convert timestamp string (MM:SS or HH:MM:SS) to seconds
 */
export function timestampToSeconds(timestamp: string): number {
  const parts = timestamp.split(':').map(Number);

  if (parts.length === 2) {
    // MM:SS format
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    // HH:MM:SS format
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return 0;
}

// =============================================================================
// COOKIE UTILITIES
// =============================================================================

/**
 * Cookie object format (from browser extension export)
 */
interface BrowserCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expirationDate?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

/**
 * Parse cookies input which can be:
 * 1. JSON array of cookie objects (from browser extension)
 * 2. JSON string of cookie array
 * 3. Simple cookie string "name=value; name2=value2"
 *
 * Returns a cookie string suitable for HTTP Cookie header
 */
export function parseCookies(cookies: string | BrowserCookie[] | undefined): string | undefined {
  if (!cookies) return undefined;

  // If it's already an array of cookie objects
  if (Array.isArray(cookies)) {
    return cookieArrayToString(cookies);
  }

  // If it's a string, try to parse as JSON first
  if (typeof cookies === 'string') {
    const trimmed = cookies.trim();

    // Check if it looks like JSON array
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as BrowserCookie[];
        if (Array.isArray(parsed)) {
          return cookieArrayToString(parsed);
        }
      } catch {
        // Not valid JSON, treat as regular cookie string
      }
    }

    // Return as-is (already in "name=value; name2=value2" format)
    return cookies;
  }

  return undefined;
}

/**
 * Convert array of cookie objects to cookie string
 */
function cookieArrayToString(cookies: BrowserCookie[]): string {
  return cookies
    .filter((cookie) => cookie.name && cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

// =============================================================================
// HTTP HEADER UTILITIES
// =============================================================================

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Create HTTP headers with optional cookies
 * Accepts cookies in multiple formats (JSON array or string)
 */
export function createHeaders(cookies?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': DEFAULT_USER_AGENT,
  };

  const cookie_string = parseCookies(cookies);
  if (cookie_string) {
    headers['Cookie'] = cookie_string;
  }

  return headers;
}

/**
 * Create headers for HTML page fetching
 */
export function createPageHeaders(cookies?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'User-Agent': DEFAULT_USER_AGENT,
  };

  const cookie_string = parseCookies(cookies);
  if (cookie_string) {
    headers['Cookie'] = cookie_string;
  }

  return headers;
}
