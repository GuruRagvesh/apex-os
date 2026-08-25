/**
 * Load .env before any test module is imported.
 * NestJS ConfigModule reads process.env, so env vars must be present before
 * AppModule boots — dotenv resolves this.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Sanity-guard: if JWT_SECRET is absent tests will fail with cryptic errors
if (!process.env.JWT_SECRET) {
  throw new Error(
    'TEST SETUP: JWT_SECRET is not set. Copy backend/.env.example to backend/.env before running tests.',
  );
}
