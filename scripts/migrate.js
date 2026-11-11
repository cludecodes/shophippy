import dotenv from 'dotenv'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(root, '.env.local') })
dotenv.config({ path: path.join(root, '.env') })
const connectionString = process.env.DATABASE_URL_UNPOOLED

if (!connectionString) {
  throw new Error('DATABASE_URL_UNPOOLED is required to run migrations safely.')
}

const migrationsPath = path.join(root, 'database', 'migrations')
const migrations = (await readdir(migrationsPath))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort()
const pool = new pg.Pool({ connectionString, max: 1 })

try {
  for (const name of migrations) {
    const migration = await readFile(path.join(migrationsPath, name), 'utf8')
    await pool.query(migration)
    console.log(`Applied migration ${name}.`)
  }
} finally {
  await pool.end()
}
