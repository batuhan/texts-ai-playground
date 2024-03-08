import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from '.'

function migrateDB() {
  migrate(db, { migrationsFolder: './src/drizzle' })
}

migrateDB()
