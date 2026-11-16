import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { env } from './config/env.js'
import apiV1Router from './routes/index.js'
import { notFoundHandler, errorHandler } from './middleware/error.middleware.js'

const app = express()

// Required behind Vercel / reverse proxies for accurate IP rate-limiting
app.set('trust proxy', 1)

// Security Headers
app.use(helmet())

// Flexible CORS configuration for local dev & Vercel deployments
const allowedOrigins = env.corsOrigin
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return callback(null, true)
      }
      // Allow localhost / 127.0.0.1 in development and Vercel preview/prod domains
      if (
        /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
        /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)
      ) {
        return callback(null, true)
      }
      return callback(new Error('Origin tidak diizinkan oleh CORS policy'))
    },
    credentials: true
  })
)

// Rate Limiting
app.use(
  '/api/',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false
  })
)

app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: true }))

// Root health check
app.get('/', (_req, res) => {
  res.json({
    success: true,
    service: 'TERRA Decoupled REST API',
    version: '1.0.0',
    docs_prefix: '/api/v1'
  })
})

// API v1 Mount
app.use('/api/v1', apiV1Router)

// 404 & Global Error Handler
app.use(notFoundHandler)
app.use(errorHandler)

export default app
