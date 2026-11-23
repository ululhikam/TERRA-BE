import { PrismaClient } from '@prisma/client'
import { env } from './env.js'

const hasValidDatabaseUrl = Boolean(
  env.databaseUrl &&
    (env.databaseUrl.startsWith('postgresql://') || env.databaseUrl.startsWith('postgres://')) &&
    !env.databaseUrl.includes('[YOUR-DB-PASSWORD]') &&
    !env.databaseUrl.includes('[PROJECT-REF]')
)

export const isDatabaseConfigured = hasValidDatabaseUrl

const globalForPrisma = globalThis

function createPrismaClient() {
  if (!hasValidDatabaseUrl) return null
  return new PrismaClient({
    log: env.nodeEnv === 'development' ? ['warn', 'error'] : ['error']
  })
}

export const prisma = hasValidDatabaseUrl
  ? globalForPrisma.__terraPrisma || (globalForPrisma.__terraPrisma = createPrismaClient())
  : null

export async function checkDatabaseHealth() {
  if (!hasValidDatabaseUrl || !prisma) {
    return {
      orm: 'prisma',
      configured: false,
      connected: false,
      mode: 'in-memory-fallback'
    }
  }
  try {
    await prisma.$queryRaw`SELECT 1`
    await prisma.event.count()
    return {
      orm: 'prisma',
      configured: true,
      connected: true,
      mode: 'postgresql-connected'
    }
  } catch (err) {
    return {
      orm: 'prisma',
      configured: true,
      connected: false,
      mode: 'migration-pending',
      error: err?.message || 'Database connection or schema check failed.'
    }
  }
}

export async function disconnectPrisma() {
  if (prisma) {
    await prisma.$disconnect()
  }
}

export function runTransaction(fn, client = prisma) {
  return client.$transaction(fn, {
    maxWait: 15000,
    timeout: 25000
  })
}
