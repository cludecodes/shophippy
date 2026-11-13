import fs from 'node:fs'
import pg from 'pg'

const envLine = fs
  .readFileSync('.env.local', 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('DATABASE_URL_UNPOOLED='))
let url = envLine.slice('DATABASE_URL_UNPOOLED='.length).trim()
if (url.startsWith('"') && url.endsWith('"')) url = url.slice(1, -1)
url = url.replace(/\\"/g, '"')

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } })
try {
  const recent = await pool.query(
    `SELECT id, public_reference, full_name, email, project_type, status, created_at
     FROM public.quote_requests
     ORDER BY created_at DESC
     LIMIT 10`,
  )
  console.log(`total rows: ${(await pool.query('SELECT COUNT(*)::int AS c FROM public.quote_requests')).rows[0].c}`)
  for (const row of recent.rows) {
    console.log(`${row.created_at.toISOString()} | ${row.public_reference} | ${row.full_name} | ${row.email} | ${row.project_type} | ${row.status}`)
  }
} finally {
  await pool.end()
}
