import app from './app.js'
import { env } from './config/env.js'
import { disconnectPrisma } from './config/prisma.js'

const server = app.listen(env.port, () => {
  console.log(`TERRA Backend API listening on http://localhost:${env.port}/api/v1`)
})

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`)
  server.close(async () => {
    await disconnectPrisma()
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
