import { Router } from 'express'
import { requireAuth } from '../middleware/auth.middleware.js'
import {
  deleteStorageObject,
  getStorageConfigStatus,
  uploadBufferToStorage,
  uploadSingleFile
} from '../services/storage.service.js'
import { env } from '../config/env.js'
import { sendSuccess, AppError, asyncHandler } from '../utils/response.js'

const router = Router()

router.get('/media/status', (_req, res) => {
  return sendSuccess(res, getStorageConfigStatus())
})

router.post(
  '/media/upload',
  requireAuth,
  uploadSingleFile.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('Pilih file terlebih dahulu (field: file).', 400, 'FILE_REQUIRED')
    }

    const folder = req.body?.folder || req.query?.folder || 'general'
    const bucketType =
      (req.body?.bucket_type || req.query?.bucket_type) === 'documents' ? 'documents' : 'media'

    const uploaded = await uploadBufferToStorage({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      folder,
      bucketType,
      ownerId: req.user?.id || 'shared'
    })

    return sendSuccess(res, uploaded, 'File berhasil diunggah ke Supabase Storage.', 201)
  })
)

router.delete(
  '/media',
  requireAuth,
  asyncHandler(async (req, res) => {
    const filePath = req.body?.path || req.query?.path
    const bucket = req.body?.bucket || req.query?.bucket || env.supabaseMediaBucket
    if (!filePath) {
      throw new AppError('Parameter path wajib diisi.', 400, 'PATH_REQUIRED')
    }
    await deleteStorageObject(String(filePath), String(bucket))
    return sendSuccess(res, { path: filePath, bucket }, 'File dihapus dari Supabase Storage.')
  })
)

export default router
