import express from 'express'
import { createApiRouter } from '../server/api.js'

const app = express()
app.disable('x-powered-by')
app.use('/api', createApiRouter())

export default function handler(request, response) {
  const route = request.query?.path
  const path = Array.isArray(route) ? route.join('/') : route || ''
  request.url = `/api/${path}`
  return app(request, response)
}
