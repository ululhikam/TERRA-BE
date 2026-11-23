import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import { requireEventPermission, requireOrganizerOrAdmin } from '../middleware/role.middleware.js'
import { requireEventModule } from '../middleware/module.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { scheduleSchema, taskSchema } from '../validators/schemas.js'
import * as db from '../repositories/db.js'
import { sendSuccess, AppError, asyncHandler } from '../utils/response.js'

const router = Router()

// Schedules
router.get('/events/:id/schedules', requireAuth, requireOrganizerOrAdmin, requireEventModule('timeline'), requireEventPermission('Manage Timeline'), asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.listSchedules(req.params.id))
}))

router.post('/events/:id/schedules', requireAuth, requireOrganizerOrAdmin, requireEventModule('timeline'), requireEventPermission('Manage Timeline'), validateBody(scheduleSchema), asyncHandler(async (req, res) => {
  const item = await db.createSchedule(req.params.id, req.validatedBody)
  return sendSuccess(res, item, 'Jadwal ditambahkan.', 201)
}))

router.patch('/schedules/:id', requireAuth, requireOrganizerOrAdmin, asyncHandler(async (req, res) => {
  const item = await db.updateSchedule(req.params.id, req.body)
  return sendSuccess(res, item, 'Jadwal diperbarui.')
}))

router.delete('/schedules/:id', requireAuth, requireOrganizerOrAdmin, asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.deleteSchedule(req.params.id), 'Jadwal dihapus.')
}))

// Hierarchical Timeline & Kanban Tasks (parent_id & is_group supported)
router.get('/events/:id/tasks', requireAuth, requireOrganizerOrAdmin, requireEventPermission('Manage Timeline'), asyncHandler(async (req, res) => {
  const evt = await db.getEventOrThrow(req.params.id)
  if (!evt.enabled_modules.includes('tasks') && !evt.enabled_modules.includes('timeline')) {
    throw new AppError('Modul tasks/timeline sedang nonaktif.', 403, 'MODULE_DISABLED')
  }
  return sendSuccess(res, await db.listTasks(req.params.id))
}))

router.post('/events/:id/tasks', requireAuth, requireOrganizerOrAdmin, requireEventPermission('Manage Timeline'), validateBody(taskSchema), asyncHandler(async (req, res) => {
  const evt = await db.getEventOrThrow(req.params.id)
  if (!evt.enabled_modules.includes('tasks') && !evt.enabled_modules.includes('timeline')) {
    throw new AppError('Modul tasks/timeline sedang nonaktif.', 403, 'MODULE_DISABLED')
  }
  const task = await db.createTask(req.params.id, req.validatedBody)
  return sendSuccess(res, task, 'Task / Checkpoint berhasil dibuat.', 201)
}))

router.patch('/tasks/:id', requireAuth, requireOrganizerOrAdmin, asyncHandler(async (req, res) => {
  const task = await db.updateTask(req.params.id, req.body)
  return sendSuccess(res, task, 'Task diperbarui.')
}))

router.delete('/tasks/:id', requireAuth, requireOrganizerOrAdmin, asyncHandler(async (req, res) => {
  return sendSuccess(res, await db.deleteTask(req.params.id), 'Task dan sub-task terkait dihapus.')
}))

router.post('/tasks/:id/comments', requireAuth, asyncHandler(async (req, res) => {
  const comment = await db.addTaskComment(req.params.id, req.user, req.body?.content || '')
  return sendSuccess(res, comment, 'Komentar ditambahkan.', 201)
}))

export default router
