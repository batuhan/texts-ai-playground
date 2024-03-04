import { db } from ".";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

function migrateDB() {
  migrate(db, { migrationsFolder: "./src/drizzle" });
}

migrateDB();
