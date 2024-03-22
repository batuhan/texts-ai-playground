import type { Config } from 'drizzle-kit'
import * as dotenv from 'dotenv'

dotenv.config();

export default {
  schema: './src/db/schema.ts',
  out: './binaries/drizzle',
  driver: 'better-sqlite',
  dbCredentials: {
    url: process.env.SQLITE_URL || './texts-ai-playground.sqlite',
  },
} satisfies Config;
