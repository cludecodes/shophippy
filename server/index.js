import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeApiPool, createApiRouter } from './api.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const app = express()
const port = Number(process.env.API_PORT || 3001)
const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('--production')

app.disable('x-powered-by')
app.use('/api', createApiRouter())

if (isProduction) {
  const dist = path.resolve(root, 'shophippy-studio', 'dist')
  app.use(express.static(dist))
  app.get('/admin', (_request, response) => {
    response.sendFile(path.join(dist, 'admin.html'))
  })
  app.get('*', (_request, response, next) => {
    response.sendFile(path.join(dist, 'index.html'), (error) => {
      if (error) next(error)
    })
  })
}

const server = app.listen(port, () => {
  console.log(`Quote API listening on http://localhost:${port}`)
})

const shutdown = async () => {
  server.close()
  await closeApiPool()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
