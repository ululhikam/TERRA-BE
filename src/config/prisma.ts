import { PrismaClient } from '@prisma/client'
import { env } from './env.js'

const hasValidDatabaseUrl = Boolean(
  env.databaseUrl &&
    (env.databaseUrl.startsWith('postgresql://') || env.databaseUrl.startsWith('postgres://')) &&
    !env.databaseUrl.includes('[YOUR-DB-PASSWORD]') &&
    !env.databaseUrl.includes('[PROJECT-REF]')
)

export const isDatabaseConfigured = hasValidDatabaseUrl

const globalForPrisma = globalThis as unknown as { __terraPrisma?: PrismaClient | null }

function createPrismaClient(): PrismaClient | null {
  if (!hasValidDatabaseUrl) return null
  return new PrismaClient({
    log: env.nodeEnv === 'development' ? ['warn', 'error'] : ['error']
  })
}

export const prisma: any = hasValidDatabaseUrl
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
  } catch (err: any) {
    return {
      orm: 'prisma',
      configured: true,
      connected: false,
      mode: 'migration-pending',
      error: err?.message || 'Database connection or schema check failed.'
    }
  }
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect()
  }
}

export function runTransaction<T>(fn: (tx: any) => Promise<T>, client: PrismaClient | null = prisma): Promise<T> {
  return client!.$transaction(fn as any, {
    maxWait: 15000,
    timeout: 25000
  }) as Promise<T>
}
