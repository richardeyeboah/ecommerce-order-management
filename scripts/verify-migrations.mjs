import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase', 'migrations')
const manifest = JSON.parse(
  await readFile(join(migrationsDir, 'manifest.json'), 'utf8')
)

if (!Array.isArray(manifest.migrations) || manifest.migrations.length === 0) {
  throw new Error('Migration manifest is empty.')
}

const seen = new Set()
for (const migration of manifest.migrations) {
  if (!/^\d{14}_[a-z0-9_]+$/.test(migration.version)) {
    throw new Error(`Invalid migration version: ${migration.version}`)
  }
  if (seen.has(migration.version)) throw new Error(`Duplicate migration: ${migration.version}`)
  seen.add(migration.version)
  const sql = await readFile(join(migrationsDir, migration.file), 'utf8')
  if (!sql.includes(`'${migration.version}'`)) {
    throw new Error(`${migration.file} does not record ${migration.version}.`)
  }
}

console.log(`Verified ${seen.size} ordered migration(s).`)
