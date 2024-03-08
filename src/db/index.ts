import { mkdirSync, existsSync } from 'fs'
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import Sqlite3 from 'better-sqlite3'
import { join, resolve } from 'path'
import { DRIZZLE_DIR_PATH } from '../constants'

import * as schema from './schema'

export type AIPlaygroundDatabase = BetterSQLite3Database<typeof schema>

const getManifestBinaryPath = (dataDirPath: string, binaryName: string) => join(dataDirPath, '..', 'platform-integration-ai-playground', 'binaries', binaryName)

const createDirIfNotExists = (dir: string) => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

const tryMigrations = (drizzleDatabase: AIPlaygroundDatabase, migrationPaths: string[]) => {
  for (const path of migrationPaths) {
    const pathExists = existsSync(path)
    if (pathExists) {
      try {
        migrate(drizzleDatabase, { migrationsFolder: path })
        return
      } catch (error) {
        console.error(`Error migrating database (${path})`, error)
      }
    }
  }

  console.error('No migration paths exist', migrationPaths)
}

export const getDatabase = (dataDirPath: string) => {
  createDirIfNotExists(dataDirPath)
  createDirIfNotExists(join(dataDirPath, 'cache'))

  const dbPath = join(dataDirPath, 'texts-ai-playground.sqlite')

  const database = new Sqlite3(dbPath)
  database.pragma('journal_mode = WAL')

  const drizzleDatabase = drizzle(database, { schema })

  const migrationPaths = [
    DRIZZLE_DIR_PATH,
    resolve(__dirname, '../../binaries/drizzle'),
    getManifestBinaryPath(dataDirPath, 'drizzle'),
  ]

  tryMigrations(drizzleDatabase, migrationPaths)

  return drizzleDatabase
}
