// User-space PostgreSQL boot for StreamRoots migration (no psql needed —
// the native package ships only initdb/pg_ctl/postgres, so SQL runs via pg client).
// Idempotent: initializes the data dir on first run, starts the server,
// creates the `streamroots` database. Safe to re-run.
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import pg from 'pg'

const ROOT = '/home/z/my-project'
const BIN = `${ROOT}/node_modules/@embedded-postgres/linux-x64/native/bin`
const DATA = `${ROOT}/db/pgdata`
const PORT = 5433
const SOCKET = `${ROOT}/db/pgsock`
export const CONN = `postgresql://streamroots@127.0.0.1:${PORT}/streamroots`

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

mkdirSync(SOCKET, { recursive: true })

if (!existsSync(`${DATA}/PG_VERSION`)) {
  console.log('initdb …')
  const init = run(`${BIN}/initdb`, ['-D', DATA, '-U', 'streamroots', '-A', 'trust', '-E', 'UTF8'])
  if (init.code !== 0) { console.error('initdb FAILED:', init.out.slice(-500)); process.exit(1) }
}

const ping = run(`${BIN}/pg_ctl`, ['-D', DATA, 'status'])
if (ping.code !== 0) {
  console.log('starting postgres …')
  const start = run(`${BIN}/pg_ctl`, ['-D', DATA, '-l', `${ROOT}/db/pg.log`, '-o', `-p ${PORT} -k ${SOCKET} -h 127.0.0.1`, 'start'])
  if (start.code !== 0) { console.error('start FAILED:', start.out.slice(-500)); process.exit(1) }
}

async function main() {
  const admin = new pg.Client({ connectionString: `postgresql://streamroots@127.0.0.1:${PORT}/postgres` })
  await admin.connect()
  const role = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname='streamroots'`)
  if (role.rowCount === 0) await admin.query(`CREATE ROLE streamroots LOGIN SUPERUSER`)
  const db = await admin.query(`SELECT 1 FROM pg_database WHERE datname='streamroots'`)
  if (db.rowCount === 0) await admin.query(`CREATE DATABASE streamroots OWNER streamroots`)
  await admin.end()

  const client = new pg.Client({ connectionString: CONN })
  await client.connect()
  const v = await client.query('SELECT version()')
  console.log('PG UP:', v.rows[0].version.split(',')[0].replace('PostgreSQL ', 'PostgreSQL '))
  console.log('CONN_STRING=' + CONN)
  await client.end()
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
