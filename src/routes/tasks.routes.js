import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import {
  requireEventPermission,
  requireOrganizerOrAdmin,
  requireResourceEventAccess
} from '../middleware/role.middleware.js'
import { requireEventModule } from '../middleware/module.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { scheduleSchema, taskCommentSchema, taskSchema, taskUpdateSchema } from '../validators/schemas.js'
import * as db from '../repositories/db.js'
import * as pricingDb from '../repositories/pricing.db.js'
import { sendSuccess, AppError, asyncHandler } from '../utils/response.js'

const router = Router()

async function assertTimelineOrTasksModule(eventId) {
  const evt = await db.getEventOrThrow(eventId)
  if (!evt.enabled_modules.includes('tasks') && !evt.enabled_modules.includes('timeline')) {
    throw new AppError('Modul tasks/timeline sedang nonaktif.', 403, 'MODULE_DISABLED')
  }
  return evt
}

// Schedules
router.get('/events/:id/schedules', requireAuth, requireOrganizerOrAdmin, requireEventModule('timeline'), requireEventPermission('View Event'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listSchedules(req.params.id))
}))

router.post('/events/:id/schedules', requireAuth, requireOrganizerOrAdmin, requireEventModule('timeline'), requireEventPermission('Manage Timeline'), validateBody(scheduleSchema), asyncHandler(async (req, res) => {
  const item = await db.createSchedule(req.params.id, req.validatedBody)
  return sendSuccess(res, item, 'Jadwal ditambahkan.', 201)
}))

router.patch(
  '/schedules/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findScheduleEventId,
    moduleKey: 'timeline',
    permission: 'Manage Timeline'
  }),
  validateBody(scheduleSchema.partial()),
  asyncHandler(async (req, res) => {
    const item = await db.updateSchedule(req.params.id, req.validatedBody)
    return sendSuccess(res, item, 'Jadwal diperbarui.')
  })
)

router.delete(
  '/schedules/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findScheduleEventId,
    moduleKey: 'timeline',
    permission: 'Manage Timeline'
  }),
  asyncHandler(async (req, res) => {
    return sendSuccess(res, await db.deleteSchedule(req.params.id), 'Jadwal dihapus.')
  })
)

// Hierarchical Timeline & Kanban Tasks (parent_id & is_group supported)
router.get('/events/:id/tasks', requireAuth, requireOrganizerOrAdmin, requireEventPermission('View Event'), asyncHandler(async (req, res) => {
  await assertTimelineOrTasksModule(req.params.id)
  if (req.user.role !== 'admin') {
    const ent = await pricingDb.ensureEventEntitlement(req.params.id)
    const allowed = new Set(ent.allowed_modules || [])
    if (!allowed.has('tasks') && !allowed.has('timeline')) {
      throw new AppError('Paket event belum mengizinkan akses modul Tasks/Timeline.', 403, 'PLAN_UPGRADE_REQUIRED')
    }
  }
  return sendSuccess(res, await db.listTasks(req.params.id))
}))

router.post('/events/:id/tasks', requireAuth, requireOrganizerOrAdmin, requireEventPermission('Manage Timeline'), validateBody(taskSchema), asyncHandler(async (req, res) => {
  await assertTimelineOrTasksModule(req.params.id)
  if (req.user.role !== 'admin') {
    await pricingDb.assertEventModuleAllowedByPlan(req.params.id, 'tasks')
  }
  const task = await db.createTask(req.params.id, req.validatedBody, req.user.id)
  return sendSuccess(res, task, 'Task / Checkpoint berhasil dibuat.', 201)
}))

router.patch(
  '/tasks/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findTaskEventId,
    permission: 'Manage Timeline'
  }),
  validateBody(taskUpdateSchema),
  asyncHandler(async (req, res) => {
    await assertTimelineOrTasksModule(req.resolvedEventId)
    const task = await db.updateTask(req.params.id, req.validatedBody)
    return sendSuccess(res, task, 'Task diperbarui.')
  })
)

router.delete(
  '/tasks/:id',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findTaskEventId,
    permission: 'Manage Timeline'
  }),
  asyncHandler(async (req, res) => {
    await assertTimelineOrTasksModule(req.resolvedEventId)
    return sendSuccess(res, await db.deleteTask(req.params.id), 'Task dan sub-task terkait dihapus.')
  })
)

router.post(
  '/tasks/:id/comments',
  requireAuth,
  requireOrganizerOrAdmin,
  requireResourceEventAccess({
    resolveEventId: db.findTaskEventId,
    permission: 'View Event'
  }),
  validateBody(taskCommentSchema),
  asyncHandler(async (req, res) => {
    const comment = await db.addTaskComment(req.params.id, req.user, req.validatedBody.content)
    return sendSuccess(res, comment, 'Komentar ditambahkan.', 201)
  })
)

export default router
