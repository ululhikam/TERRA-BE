import crypto from 'node:crypto'
import path from 'node:path'
import multer from 'multer'
import { env } from '../config/env.js'
import { isSupabaseEnabled, supabaseAdmin } from '../config/supabase.js'
import { AppError } from '../utils/response.js'

const ensuredBuckets = new Set()

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml'
])

const DOC_MIME_TYPES = new Set([
  ...IMAGE_MIME_TYPES,
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
])

export const uploadSingleFile = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4 * 1024 * 1024 // 4MB max (safe within Vercel Serverless request limits)
  }
})

export function getStorageConfigStatus() {
  return {
    configured: Boolean(isSupabaseEnabled && supabaseAdmin),
    media_bucket: env.supabaseMediaBucket,
    documents_bucket: env.supabaseDocsBucket
  }
}

export async function ensureStorageBucket(bucketName, isPublic = true) {
  if (!isSupabaseEnabled || !supabaseAdmin) return false
  if (ensuredBuckets.has(bucketName)) return true

  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets()
  if (listErr) {
    throw new AppError(`Gagal memeriksa Supabase Storage bucket: ${listErr.message}`, 500, 'STORAGE_ERROR')
  }

  const existing = (buckets || []).find((b) => b.name === bucketName)
  if (!existing) {
    const { error: createErr } = await supabaseAdmin.storage.createBucket(bucketName, {
      public: isPublic,
      fileSizeLimit: 10 * 1024 * 1024
    })
    if (createErr && !createErr.message?.toLowerCase().includes('already')) {
      throw new AppError(`Gagal membuat bucket ${bucketName}: ${createErr.message}`, 500, 'STORAGE_ERROR')
    }
  } else if (Boolean(existing.public) !== Boolean(isPublic)) {
    await supabaseAdmin.storage.updateBucket(bucketName, { public: isPublic }).catch(() => {})
  }

  ensuredBuckets.add(bucketName)
  return true
}

function sanitizeFileName(originalName = 'file') {
  const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.bin'
  const base = path
    .basename(originalName, path.extname(originalName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'asset'
  const rand = crypto.randomBytes(4).toString('hex')
  return `${Date.now()}-${rand}-${base}${ext}`
}

function sanitizeFolder(folder = 'general') {
  return (
    String(folder)
      .toLowerCase()
      .replace(/[^a-z0-9/_-]+/g, '')
      .replace(/^\/+|\/+$/g, '') || 'general'
  )
}

export async function uploadBufferToStorage({
  buffer,
  originalName,
  mimeType,
  folder = 'general',
  bucketType = 'media',
  ownerId = 'shared'
}) {
  if (!buffer || !buffer.length) {
    throw new AppError('File tidak ditemukan atau kosong.', 400, 'FILE_REQUIRED')
  }

  const isDocs = bucketType === 'documents'
  const allowedMimes = isDocs ? DOC_MIME_TYPES : IMAGE_MIME_TYPES
  if (!allowedMimes.has(String(mimeType || '').toLowerCase())) {
    throw new AppError(
      isDocs
        ? 'Format dokumen tidak didukung. Gunakan PDF, Office (DOCX/XLSX/PPTX), CSV, TXT, atau gambar.'
        : 'Format gambar tidak didukung. Gunakan JPG, PNG, WEBP, GIF, atau SVG.',
      415,
      'UNSUPPORTED_MEDIA_TYPE'
    )
  }

  const bucketName = isDocs ? env.supabaseDocsBucket : env.supabaseMediaBucket
  const cleanFolder = sanitizeFolder(folder)
  const cleanOwner = sanitizeFolder(ownerId)
  const fileName = sanitizeFileName(originalName)
  const objectPath = `${cleanFolder}/${cleanOwner}/${fileName}`

  if (!isSupabaseEnabled || !supabaseAdmin) {
    return {
      bucket: bucketName,
      path: objectPath,
      public_url: isDocs ? null : `https://storage.supabase.co/object/public/${bucketName}/${objectPath}`,
      signed_url: isDocs ? `https://storage.supabase.co/signed/${objectPath}?token=mock` : null,
      file_name: originalName,
      mime_type: mimeType,
      size: buffer.length,
      storage: 'mock-fallback'
    }
  }

  await ensureStorageBucket(bucketName, !isDocs)

  const { error: uploadErr } = await supabaseAdmin.storage
    .from(bucketName)
    .upload(objectPath, buffer, {
      contentType: mimeType,
      cacheControl: '3600',
      upsert: false
    })

  if (uploadErr) {
    throw new AppError(`Gagal mengunggah file ke Supabase Storage: ${uploadErr.message}`, 500, 'STORAGE_UPLOAD_FAILED')
  }

  let publicUrl = null
  let signedUrl = null
  if (!isDocs) {
    const { data: pubData } = supabaseAdmin.storage.from(bucketName).getPublicUrl(objectPath)
    publicUrl = pubData?.publicUrl || null
  } else {
    const { data: signData } = await supabaseAdmin.storage
      .from(bucketName)
      .createSignedUrl(objectPath, 300, { download: originalName })
    signedUrl = signData?.signedUrl || null
  }

  return {
    bucket: bucketName,
    path: objectPath,
    public_url: publicUrl,
    signed_url: signedUrl,
    file_name: originalName,
    mime_type: mimeType,
    size: buffer.length,
    storage: 'supabase'
  }
}

export async function createSignedDocumentUrl(
  filePath,
  { bucket = env.supabaseDocsBucket, expiresIn = 300, downloadName } = {}
) {
  if (!isSupabaseEnabled || !supabaseAdmin) {
    return `https://storage.supabase.co/signed/${filePath}?token=mock`
  }

  await ensureStorageBucket(bucket, false)
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(filePath, expiresIn, downloadName ? { download: downloadName } : undefined)

  if (error || !data?.signedUrl) {
    throw new AppError(
      error?.message || 'File belum tersedia di Supabase Storage bucket.',
      404,
      'STORAGE_OBJECT_NOT_FOUND'
    )
  }
  return data.signedUrl
}

export async function deleteStorageObject(filePath, bucket = env.supabaseMediaBucket) {
  if (!filePath || !isSupabaseEnabled || !supabaseAdmin) return
  await supabaseAdmin.storage.from(bucket).remove([filePath]).catch(() => {})
}
