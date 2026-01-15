import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeSchema } from '../lib/db.js';

// =============================================================================
// DATABASE INITIALIZATION ENDPOINT
// =============================================================================
// POST /api/init
//
// Initializes the database schema.
// Run this once during deployment or when setting up a new environment.
//
// Security: Protected by CRON_SECRET header
// =============================================================================

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<VercelResponse> {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify secret in production
  const cron_secret = process.env.CRON_SECRET;
  const authorization = req.headers.authorization;

  if (cron_secret && authorization !== `Bearer ${cron_secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('[Init] Initializing database schema...');
    await initializeSchema();

    return res.status(200).json({
      success: true,
      message: 'Database schema initialized successfully',
    });
  } catch (error) {
    console.error('[Init] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to initialize database',
    });
  }
}
