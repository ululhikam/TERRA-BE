import { Router } from 'express'
import { optionalAuth, requireAuth } from '../middleware/auth.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import {
  reportCreateSchema,
  companionPostCreateSchema,
  companionPostUpdateSchema,
  companionReplyCreateSchema
} from '../validators/schemas.js'
import * as db from '../repositories/db.js'
import { sendSuccess, asyncHandler } from '../utils/response.js'

const router = Router()

router.get('/marketplace/events', asyncHandler(async (req, res) => {
  const { items, meta } = await db.listMarketplaceEvents(req.query)
  return sendSuccess(res, items, 'Daftar event marketplace.', 200, meta)
}))

router.get('/marketplace/featured', asyncHandler(async (_req, res) => {
  return sendSuccess(res, await db.listFeaturedMarketplaceEvents())
}))

router.get('/marketplace/search', asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.searchMarketplaceEvents(req.query.q))
}))

router.get('/marketplace/categories', asyncHandler(async (_req, res) => {
  return sendSuccess(res, await db.listActiveCategories())
}))

router.get('/marketplace/organizers', asyncHandler(async (_req, res) => {
  return sendSuccess(res, await db.listMarketplaceOrganizers())
}))

router.get('/marketplace/events/:slug', asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.getPublicEventBySlugOrId(req.params.slug))
}))

router.get('/marketplace/events/:slug/surveys', asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listPublicSurveysByEvent(req.params.slug))
}))

router.get('/marketplace/organizers/:slug', asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.getPublicOrganizerBySlug(req.params.slug))
}))

router.post('/marketplace/events/:id/report', optionalAuth, validateBody(reportCreateSchema), asyncHandler(async (req, res) => {
  const report = await db.createEventReport(req.params.id, req.user?.id, req.validatedBody)
  return sendSuccess(res, report, 'Laporan telah diterima dan akan ditinjau oleh Admin.', 201)
}))

// ---------------- FORUM TEMAN BERANGKAT EVENT ----------------
router.get('/marketplace/events/:slug/companions', asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listEventCompanionPosts(req.params.slug))
}))

router.post(
  '/marketplace/events/:slug/companions',
  requireAuth,
  validateBody(companionPostCreateSchema),
  asyncHandler(async (req, res) => {
    const created = await db.createEventCompanionPost(req.params.slug, req.user, req.validatedBody)
    return sendSuccess(res, created, 'Ajakan berangkat bareng berhasil diposting ke forum.', 201)
  })
)

router.patch(
  '/marketplace/companions/:postId',
  requireAuth,
  validateBody(companionPostUpdateSchema),
  asyncHandler(async (req, res) => {
    const updated = await db.updateEventCompanionPost(req.params.postId, req.user, req.validatedBody)
    return sendSuccess(res, updated, 'Postingan forum berhasil diperbarui.')
  })
)

router.delete(
  '/marketplace/companions/:postId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await db.deleteEventCompanionPost(req.params.postId, req.user)
    return sendSuccess(res, result, 'Postingan forum dihapus.')
  })
)

router.post(
  '/marketplace/companions/:postId/replies',
  requireAuth,
  validateBody(companionReplyCreateSchema),
  asyncHandler(async (req, res) => {
    const updatedPost = await db.createEventCompanionReply(req.params.postId, req.user, req.validatedBody)
    return sendSuccess(res, updatedPost, 'Balasan berhasil dikirim ke forum.', 201)
  })
)

export default router
