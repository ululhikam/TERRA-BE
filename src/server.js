import app from './app.js'
import { env } from './config/env.js'

app.listen(env.port, () => {
  console.log(`TERRA Backend API listening on http://localhost:${env.port}/api/v1`)
})
