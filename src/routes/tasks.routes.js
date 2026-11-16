import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import { requireOrganizerOrAdmin } from '../middleware/role.middleware.js'
import { requireEventModule } from '../middleware/module.middleware.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { scheduleSchema, taskSchema } from '../validators/schemas.js'
import { store } from '../repositories/store.js'
import { sendSuccess, AppError } from '../utils/response.js'

const router = Router()

// Schedules
router.get('/events/:id/schedules', requireAuth, requireEventModule('timeline'), (req, res) => {
  return sendSuccess(res, store.schedules.filter((s) => s.event_id === req.params.id))
})

router.post('/events/:id/schedules', requireAuth, requireOrganizerOrAdmin, requireEventModule('timeline'), validateBody(scheduleSchema), (req, res) => {
  const item = { id: 'sch-' + Date.now(), event_id: req.params.id, ...req.validatedBody }
  store.schedules.push(item)
  return sendSuccess(res, item, 'Jadwal ditambahkan.', 201)
})

router.patch('/schedules/:id', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  const item = store.schedules.find((s) => s.id === req.params.id)
  if (!item) throw new AppError('Jadwal tidak ditemukan.', 404, 'SCHEDULE_NOT_FOUND')
  Object.assign(item, req.body)
  return sendSuccess(res, item, 'Jadwal diperbarui.')
})

router.delete('/schedules/:id', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  store.schedules = store.schedules.filter((s) => s.id !== req.params.id)
  return sendSuccess(res, { id: req.params.id }, 'Jadwal dihapus.')
})

// Hierarchical Timeline & Kanban Tasks (parent_id & is_group supported)
router.get('/events/:id/tasks', requireAuth, (req, res) => {
  const evt = store.getEvent(req.params.id)
  if (!evt.enabled_modules.includes('tasks') && !evt.enabled_modules.includes('timeline')) {
    throw new AppError('Modul tasks/timeline sedang nonaktif.', 403, 'MODULE_DISABLED')
  }
  return sendSuccess(res, store.tasks.filter((t) => t.event_id === req.params.id))
})

router.post('/events/:id/tasks', requireAuth, requireOrganizerOrAdmin, validateBody(taskSchema), (req, res) => {
  const evt = store.getEvent(req.params.id)
  if (!evt.enabled_modules.includes('tasks') && !evt.enabled_modules.includes('timeline')) {
    throw new AppError('Modul tasks/timeline sedang nonaktif.', 403, 'MODULE_DISABLED')
  }

  const data = req.validatedBody
  const isGroup = data.is_group ?? !data.parent_id
  const dueAt = data.due_at || data.due_date || '2026-12-01'
  const task = {
    id: (isGroup ? 'chk-' : 'tsk-') + Date.now(),
    event_id: req.params.id,
    parent_id: data.parent_id || null,
    is_group: Boolean(isGroup),
    ...data,
    due_at: dueAt,
    due_date: dueAt,
    comments: []
  }
  store.tasks.push(task)
  return sendSuccess(res, task, 'Task / Checkpoint berhasil dibuat.', 201)
})

router.patch('/tasks/:id', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  const task = store.tasks.find((t) => t.id === req.params.id)
  if (!task) throw new AppError('Task tidak ditemukan.', 404, 'TASK_NOT_FOUND')

  // If moving a parent checkpoint's start_date, cascade shift children if deltaDays is provided
  if (task.is_group && req.body.shift_days) {
    const delta = Number(req.body.shift_days)
    const addDays = (str) => {
      const d = new Date(str.slice(0, 10) + 'T00:00:00')
      d.setDate(d.getDate() + delta)
      return d.toISOString().slice(0, 10)
    }
    store.tasks.forEach((child) => {
      if (child.parent_id === task.id) {
        if (child.start_date) child.start_date = addDays(child.start_date)
        const dueStr = child.due_at || child.due_date
        if (dueStr) {
          const nextDue = addDays(dueStr)
          child.due_at = nextDue
          child.due_date = nextDue
        }
      }
    })
  }

  const patch = { ...req.body }
  delete patch.shift_days
  if (patch.due_date && !patch.due_at) patch.due_at = patch.due_date
  if (patch.due_at && !patch.due_date) patch.due_date = patch.due_at
  Object.assign(task, patch)
  return sendSuccess(res, task, 'Task diperbarui.')
})

router.delete('/tasks/:id', requireAuth, requireOrganizerOrAdmin, (req, res) => {
  store.tasks = store.tasks.filter((t) => t.id !== req.params.id && t.parent_id !== req.params.id)
  return sendSuccess(res, { id: req.params.id }, 'Task dan sub-task terkait dihapus.')
})

router.post('/tasks/:id/comments', requireAuth, (req, res) => {
  const task = store.tasks.find((t) => t.id === req.params.id)
  if (!task) throw new AppError('Task tidak ditemukan.', 404, 'TASK_NOT_FOUND')
  const comment = {
    id: 'cmt-' + Date.now(),
    user_id: req.user.id,
    author: req.user.full_name,
    content: req.body?.content || '',
    created_at: new Date().toISOString()
  }
  task.comments = task.comments || []
  task.comments.push(comment)
  return sendSuccess(res, comment, 'Komentar ditambahkan.', 201)
})

export default router
