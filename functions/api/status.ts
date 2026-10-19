import type { Handler } from '../_lib/env';
import { json } from '../_lib/http';

// First version; Task 8 adds the real AI availability check.
export const GET: Handler = async () => json({ ai: 'off', reason: 'not-configured' });
