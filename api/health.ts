import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPendingVideoJobs } from '../lib/db.js';

// =============================================================================
// HEALTH CHECK ENDPOINT
// =============================================================================
// GET /api/health
//
// Returns service health status
// =============================================================================

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  pending_jobs?: number;
  database?: {
    connected: boolean;
  };
  qstash?: {
    configured: boolean;
  };
  errors?: string[];
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<VercelResponse> {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const response: HealthResponse = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
  };

  const errors: string[] = [];

  // Check QStash configuration
  response.qstash = {
    configured: !!process.env.QSTASH_TOKEN,
  };
  if (!process.env.QSTASH_TOKEN) {
    errors.push('QStash: QSTASH_TOKEN not configured');
  }

  // Check database
  try {
    if (!process.env.DATABASE_URL) {
      errors.push('Database: DATABASE_URL not configured');
      response.database = { connected: false };
    } else {
      // Try to query pending jobs as a health check
      const pending = await getPendingVideoJobs(1);
      response.database = { connected: true };
      
      // Get actual count
      const all_pending = await getPendingVideoJobs(1000);
      response.pending_jobs = all_pending.length;
    }
  } catch (error) {
    errors.push(`Database: ${error instanceof Error ? error.message : 'Connection failed'}`);
    response.database = { connected: false };
  }

  // Determine overall status
  if (errors.length > 0) {
    response.status = errors.length > 1 ? 'unhealthy' : 'degraded';
    response.errors = errors;
  }

  const status_code = response.status === 'healthy' ? 200 : response.status === 'degraded' ? 200 : 503;

  return res.status(status_code).json(response);
}
