import type { GraphQLRequest } from '../types.js';
import { parseCookies } from './utils.js';

// =============================================================================
// GRAPHQL CLIENT - Node.js implementation for Loom's GraphQL API
// =============================================================================

const GRAPHQL_ENDPOINT = 'https://www.loom.com/graphql';

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

interface GraphQLClientOptions {
  cookies?: string;
  timeout?: number;
}

interface GraphQLResult<T> {
  data: T | null;
  error?: string;
}

/**
 * Generic GraphQL client for Loom API
 * @param request - The GraphQL request containing operationName, query, and variables
 * @param options - Optional settings like cookies for authentication
 * @returns The data from the GraphQL response, or null if the request failed
 */
export async function graphqlClient<T>(
  request: GraphQLRequest,
  options?: GraphQLClientOptions
): Promise<T | null> {
  try {
    const headers: Record<string, string> = { ...DEFAULT_HEADERS };

    // Add cookies if provided
    if (options?.cookies) {
      const cookie_string = parseCookies(options.cookies);
      if (cookie_string) {
        headers['Cookie'] = cookie_string;
      }
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeout_id = setTimeout(
      () => controller.abort(),
      options?.timeout ?? 30000 // 30 second default timeout
    );

    try {
      const response = await fetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeout_id);

      if (!response.ok) {
        console.error(`[GraphQL] Request failed: ${response.status} ${response.statusText}`);
        return null;
      }

      const result = (await response.json()) as { data?: T; errors?: unknown[] };

      if (result.errors) {
        console.error('[GraphQL] Errors:', JSON.stringify(result.errors));
        return null;
      }

      return result.data ?? null;
    } finally {
      clearTimeout(timeout_id);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[GraphQL] Request timeout');
    } else {
      console.error('[GraphQL] Client error:', error);
    }
    return null;
  }
}

/**
 * GraphQL client with authentication headers for folder operations
 * Returns both data and error for better error handling
 */
export async function graphqlClientWithAuth<T>(
  query: string,
  operationName: string,
  variables: Record<string, unknown>,
  cookies: string
): Promise<GraphQLResult<T>> {
  try {
    const cookie_string = parseCookies(cookies);

    if (!cookie_string) {
      return { data: null, error: 'Invalid or missing cookies' };
    }

    const controller = new AbortController();
    const timeout_id = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Cookie: cookie_string,
          Origin: 'https://www.loom.com',
          Referer: 'https://www.loom.com/',
        },
        body: JSON.stringify({
          operationName,
          query,
          variables,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout_id);

      if (!response.ok) {
        const error_text = await response.text();
        console.error(`[GraphQL Auth] Error response: ${error_text}`);
        return { data: null, error: `HTTP ${response.status}: ${response.statusText}` };
      }

      const result = (await response.json()) as { data?: T; errors?: unknown[] };

      if (result.errors) {
        return { data: null, error: `GraphQL errors: ${JSON.stringify(result.errors)}` };
      }

      return { data: result.data ?? null };
    } finally {
      clearTimeout(timeout_id);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { data: null, error: 'Request timeout' };
    }
    console.error('[GraphQL Auth] Client error:', error);
    return {
      data: null,
      error: `Client error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
