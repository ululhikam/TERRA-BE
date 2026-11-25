import { Router } from 'express'
import { env } from '../config/env.js'
import { requireAuth } from '../middleware/auth.middleware.js'
import {
  requireActiveSubscription,
  requireEventPermission,
  requireOrganizerOrAdmin,
  requireResourceEventAccess
} from '../middleware/role.middleware.js'
import { requireEventModule } from '../middleware/module.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import {
  financeRecordSchema,
  sponsorSchema,
  surveyCreateSchema,
  vendorSchema
} from '../validators/schemas.js'
import {
  createSignedDocumentUrl,
  deleteStorageObject,
  uploadBufferToStorage,
  uploadSingleFile
} from '../services/storage.service.js'
import * as db from '../repositories/db.js'
import { sendSuccess, AppError, asyncHandler } from '../utils/response.js'

const router = Router()

router.use('/events', requireAuth, requireOrganizerOrAdmin, requireActiveSubscription)
router.use('/finance', requireAuth, requireOrganizerOrAdmin, requireActiveSubscription)
router.use('/vendors', requireAuth, requireOrganizerOrAdmin, requireActiveSubscription)
router.use('/sponsors', requireAuth, requireOrganizerOrAdmin, requireActiveSubscription)

// ---------------- FINANCE (With Automated Paid Ticket Revenue) ----------------
router.get('/events/:id/finance/summary', requireAuth, requireOrganizerOrAdmin, requireEventModule('finance'), requireEventPermission('View Finance'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.getFinanceSummary(req.params.id))
}))

router.get('/events/:id/finance/budgets', requireAuth, requireOrganizerOrAdmin, requireEventModule('finance'), requireEventPermission('View Finance'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.getBudget(req.params.id))
}))

router.post('/events/:id/finance/budgets', requireAuth, requireOrganizerOrAdmin, requireEventModule('finance'), requireEventPermission('View Finance'), asyncHandler(async (req, res) => {
  const amount = Number(req.body?.amount || 0)
  if (amount < 0) throw new AppError('Budget tidak boleh negatif.', 422, 'INVALID_BUDGET')
  const budget = await db.setBudget(req.params.id, amount)
  return sendSuccess(res, budget, 'Anggaran event diperbarui.', 201)
}))

router.get('/events/:id/finance/incomes', requireAuth, requireOrganizerOrAdmin, requireEventModule('finance'), requireEventPermission('View Finance'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listIncomes(req.params.id))
}))

router.post('/events/:id/finance/incomes', requireAuth, requireOrganizerOrAdmin, requireEventModule('finance'), requireEventPermission('View Finance'), validateBody(financeRecordSchema), asyncHandler(async (req, res) => {
  const item = await db.createIncome(req.params.id, req.validatedBody, req.user.id)
  return sendSuccess(res, item, 'Pemasukan dicatat.', 201)
}))

router.patch(
  '/finance/incomes/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findIncomeEventId,
    moduleKey: 'finance',
    permission: 'View Finance'
  }),
  validateBody(financeRecordSchema.partial()),
  asyncHandler(async (req, res) => {
    const item = await db.updateIncome(req.params.id, req.validatedBody)
    return sendSuccess(res, item, 'Pemasukan diperbarui.')
  })
)

router.delete(
  '/finance/incomes/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findIncomeEventId,
    moduleKey: 'finance',
    permission: 'View Finance'
  }),
  asyncHandler(async (req, res) => {
    const result = await db.deleteIncome(req.params.id)
    return sendSuccess(res, result, 'Pemasukan dihapus.')
  })
)

router.get('/events/:id/finance/expenses', requireAuth, requireOrganizerOrAdmin, requireEventModule('finance'), requireEventPermission('View Finance'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listExpenses(req.params.id))
}))

router.post('/events/:id/finance/expenses', requireAuth, requireOrganizerOrAdmin, requireEventModule('finance'), requireEventPermission('View Finance'), validateBody(financeRecordSchema), asyncHandler(async (req, res) => {
  const item = await db.createExpense(req.params.id, req.validatedBody, req.user.id)
  return sendSuccess(res, item, 'Pengeluaran dicatat.', 201)
}))

router.patch(
  '/finance/expenses/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findExpenseEventId,
    moduleKey: 'finance',
    permission: 'View Finance'
  }),
  validateBody(financeRecordSchema.partial()),
  asyncHandler(async (req, res) => {
    const item = await db.updateExpense(req.params.id, req.validatedBody)
    return sendSuccess(res, item, 'Pengeluaran diperbarui.')
  })
)

router.delete(
  '/finance/expenses/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findExpenseEventId,
    moduleKey: 'finance',
    permission: 'View Finance'
  }),
  asyncHandler(async (req, res) => {
    const result = await db.deleteExpense(req.params.id)
    return sendSuccess(res, result, 'Pengeluaran dihapus.')
  })
)

// ---------------- VENDORS ----------------
router.get('/events/:id/vendors', requireAuth, requireOrganizerOrAdmin, requireEventModule('vendors'), requireEventPermission('View Event'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listVendors(req.params.id))
}))

router.post('/events/:id/vendors', requireAuth, requireOrganizerOrAdmin, requireEventModule('vendors'), requireEventPermission('Edit Event'), validateBody(vendorSchema), asyncHandler(async (req, res) => {
  const v = await db.createVendor(req.params.id, req.validatedBody)
  return sendSuccess(res, v, 'Vendor ditambahkan.', 201)
}))

router.patch(
  '/vendors/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findVendorEventId,
    moduleKey: 'vendors',
    permission: 'Edit Event'
  }),
  validateBody(vendorSchema.partial()),
  asyncHandler(async (req, res) => {
    const v = await db.updateVendor(req.params.id, req.validatedBody)
    return sendSuccess(res, v, 'Vendor diperbarui.')
  })
)

router.delete(
  '/vendors/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findVendorEventId,
    moduleKey: 'vendors',
    permission: 'Edit Event'
  }),
  asyncHandler(async (req, res) => {
    return sendSuccess(res, await db.deleteVendor(req.params.id), 'Vendor dihapus.')
  })
)

// ---------------- SPONSORS ----------------
router.get('/events/:id/sponsors', requireAuth, requireOrganizerOrAdmin, requireEventModule('sponsors'), requireEventPermission('View Event'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listSponsors(req.params.id))
}))

router.post('/events/:id/sponsors', requireAuth, requireOrganizerOrAdmin, requireEventModule('sponsors'), requireEventPermission('Edit Event'), validateBody(sponsorSchema), asyncHandler(async (req, res) => {
  const s = await db.createSponsor(req.params.id, req.validatedBody)
  return sendSuccess(res, s, 'Sponsor ditambahkan.', 201)
}))

router.patch(
  '/sponsors/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findSponsorEventId,
    moduleKey: 'sponsors',
    permission: 'Edit Event'
  }),
  validateBody(sponsorSchema.partial()),
  asyncHandler(async (req, res) => {
    const s = await db.updateSponsor(req.params.id, req.validatedBody)
    return sendSuccess(res, s, 'Sponsor diperbarui.')
  })
)

router.delete(
  '/sponsors/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findSponsorEventId,
    moduleKey: 'sponsors',
    permission: 'Edit Event'
  }),
  asyncHandler(async (req, res) => {
    return sendSuccess(res, await db.deleteSponsor(req.params.id), 'Sponsor dihapus.')
  })
)

// ---------------- DOCUMENTS ----------------
router.get('/events/:id/documents', requireAuth, requireOrganizerOrAdmin, requireEventModule('documents'), requireEventPermission('View Event'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listDocuments(req.params.id))
}))

router.post(
  '/events/:id/documents',
  requireAuth,
  requireOrganizerOrAdmin,
  requireEventModule('documents'),
  requireEventPermission('Edit Event'),
  uploadSingleFile.single('file'),
  asyncHandler(async (req, res) => {
    let payload = { ...(req.body || {}) }

    if (req.file) {
      const uploaded = await uploadBufferToStorage({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        folder: `events/${req.params.id}/documents`,
        bucketType: 'documents',
        ownerId: req.user.id
      })
      payload.file_name = payload.file_name || req.file.originalname
      payload.file_type = req.file.mimetype
      payload.file_path = uploaded.path
    }

    const doc = await db.createDocument(req.params.id, payload, req.user.id)
    return sendSuccess(res, doc, 'Dokumen diunggah ke Supabase Storage.', 201)
  })
)

router.get('/documents/:id/download', requireAuth, asyncHandler(async (req, res) => {
  const doc = await db.findDocument(req.params.id)
  if (doc.visibility !== 'public' && req.user.role !== 'admin') {
    const perms = await db.getUserEventPermissions(req.user, doc.event_id)
    if (!perms.includes('View Event')) {
      throw new AppError('Anda tidak memiliki izin mengunduh dokumen internal event ini.', 403, 'FORBIDDEN_PERMISSION')
    }
  }
  const signedUrl = await createSignedDocumentUrl(doc.file_path, {
    bucket: env.supabaseDocsBucket,
    expiresIn: 300,
    downloadName: doc.file_name
  })
  return sendSuccess(res, { signed_url: signedUrl, file_name: doc.file_name })
}))

router.delete(
  '/documents/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findDocumentEventId,
    moduleKey: 'documents',
    permission: 'Edit Event'
  }),
  asyncHandler(async (req, res) => {
    const doc = await db.findDocument(req.params.id).catch(() => null)
    if (doc?.file_path) {
      await deleteStorageObject(doc.file_path, env.supabaseDocsBucket)
    }
    return sendSuccess(res, await db.deleteDocument(req.params.id), 'Dokumen dihapus.')
  })
)

// ---------------- SURVEYS & FEEDBACK ----------------
router.get('/events/:id/surveys', requireAuth, requireOrganizerOrAdmin, requireEventModule('feedback'), requireEventPermission('View Event'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listSurveys(req.params.id))
}))

router.post('/events/:id/surveys', requireAuth, requireOrganizerOrAdmin, requireEventModule('feedback'), requireEventPermission('Edit Event'), validateBody(surveyCreateSchema), asyncHandler(async (req, res) => {
  const srv = await db.createSurvey(req.params.id, req.validatedBody)
  return sendSuccess(res, srv, 'Survey dibuat.', 201)
}))

router.post('/surveys/:id/responses', requireAuth, asyncHandler(async (req, res) => {
  const resp = await db.submitSurveyResponse(req.params.id, req.user.id, req.body?.answers || {})
  return sendSuccess(res, resp, 'Terima kasih atas feedback Anda.', 201)
}))

// ---------------- DEEP ANALYTICS & REPORTS ----------------
router.get('/events/:id/reports', requireAuth, requireOrganizerOrAdmin, requireEventModule('reports'), requireEventPermission('View Event'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.getEventReports(req.params.id))
}))

export default router
