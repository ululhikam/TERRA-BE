import { Router } from 'express'
import { checkSupabaseHealth } from '../config/supabase.js'
import { checkDatabaseHealth } from '../config/prisma.js'
import { env } from '../config/env.js'
import { getEmailConfigStatus } from '../services/email.service.js'
import { getStorageConfigStatus } from '../services/storage.service.js'
import authRoutes from './auth.routes.js'
import organizationsRoutes from './organizations.routes.js'
import eventsRoutes from './events.routes.js'
import tasksRoutes from './tasks.routes.js'
import ticketingRoutes from './ticketing.routes.js'
import participantsRoutes from './participants.routes.js'
import operationsRoutes from './operations.routes.js'
import marketplaceRoutes from './marketplace.routes.js'
import adminRoutes from './admin.routes.js'
import mediaRoutes from './media.routes.js'
import pricingRoutes from './pricing.routes.js'

const router = Router()

router.get('/health', async (_req, res) => {
  const [database, supabase] = await Promise.all([checkDatabaseHealth(), checkSupabaseHealth()])
  res.json({
    success: true,
    message: 'TERRA API v1 is healthy',
    environment: env.nodeEnv,
    database,
    supabase,
    storage: getStorageConfigStatus(),
    email: getEmailConfigStatus(),
    timestamp: new Date().toISOString()
  })
})

router.use(authRoutes)
router.use(organizationsRoutes)
router.use(eventsRoutes)
router.use(tasksRoutes)
router.use(ticketingRoutes)
router.use(participantsRoutes)
router.use(operationsRoutes)
router.use(marketplaceRoutes)
router.use(adminRoutes)
router.use(mediaRoutes)
router.use(pricingRoutes)

export default router
