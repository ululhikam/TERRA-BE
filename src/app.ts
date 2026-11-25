import './types/express.js'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { env } from './config/env.js'
import passport from './config/passport.js'
import apiV1Router from './routes/index.js'
import { requestLogger } from './middleware/logger.middleware.js'
import { notFoundHandler, errorHandler } from './middleware/error.middleware.js'

const app = express()

// Required behind Vercel / reverse proxies for accurate IP rate-limiting
app.set('trust proxy', 1)

// Security Headers
app.use(helmet())

// Strict CORS configuration for configured origins & Vercel concern2 deployments
const allowedOrigins = env.corsOrigin
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean)

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      const normalized = origin.replace(/\/+$/, '')
      if (allowedOrigins.includes(normalized) || normalized === env.frontendUrl) {
        return callback(null, true)
      }
      if (env.nodeEnv !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)) {
        return callback(null, true)
      }
      if (/^https:\/\/([a-z0-9-]+\.)?concern\.web\.id$/i.test(normalized)) {
        return callback(null, true)
      }
      if (/^https:\/\/(terra-concern|frontend-[a-z0-9-]+-concern2)\.vercel\.app$/i.test(normalized)) {
        return callback(null, true)
      }
      if (/^https:\/\/([a-z0-9-]+\.)?midtrans\.com$/i.test(normalized)) {
        return callback(null, true)
      }
      return callback(new Error('Origin tidak diizinkan oleh CORS policy'))
    },
    credentials: true
  })
)

// Rate Limiting
const skipTestRateLimit = () => env.nodeEnv === 'test'

app.use(
  '/api/',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipTestRateLimit
  })
)

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipTestRateLimit,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Terlalu banyak percobaan autentikasi. Coba lagi nanti.' }
  }
})

const sensitiveActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipTestRateLimit
})

app.use(
  [
    '/api/v1/auth/login',
    '/api/v1/auth/register',
    '/api/v1/auth/verify-otp',
    '/api/v1/auth/resend-otp',
    '/api/v1/auth/forgot-password',
    '/api/v1/auth/reset-password'
  ],
  authLimiter
)
app.use(['/api/v1/orders', '/api/v1/tickets/check-in', '/api/v1/tickets/validate'], sensitiveActionLimiter)

app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(requestLogger)
app.use(passport.initialize())

// Root health check
app.get('/', (_req, res) => {
  res.json({
    success: true,
    service: 'TERRA Decoupled REST API',
    version: '1.0.0',
    docs_prefix: '/api/v1'
  })
})

// API v1 Routes
app.use('/api/v1', apiV1Router)

// 404 & Error Handlers
app.use(notFoundHandler)
app.use(errorHandler)

export default app
