import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'path'
import { processSupport } from './functions/api/_support-core.js'

// Dev-only: make POST /api/support work under `npm run dev` (Vite), using the
// same core logic as the Cloudflare Pages Function. Reads keys from .env.local.
function supportApiDev(env) {
  return {
    name: 'support-api-dev',
    configureServer(server) {
      server.middlewares.use('/api/support', (req, res, next) => {
        if (req.method !== 'POST') return next()
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', async () => {
          let input = {}
          try { input = JSON.parse(raw || '{}') } catch { /* ignore */ }
          try {
            const { status, body } = await processSupport(input, env)
            res.statusCode = status
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(body))
          } catch (e) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: String(e?.message || e) }))
          }
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Load ALL env vars (no prefix filter) so server-side keys in .env.local are available.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [supportApiDev(env)],
    server: {
      host: true,
      port: 5173,
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          home: resolve(__dirname, 'home.html'),
          shop: resolve(__dirname, 'shop.html'),
          checkout: resolve(__dirname, 'checkout.html'),
          'order-confirm': resolve(__dirname, 'order-confirm.html'),
          'track-order': resolve(__dirname, 'track-order.html'),
          review: resolve(__dirname, 'review.html'),
          privacy: resolve(__dirname, 'privacy.html'),
          terms: resolve(__dirname, 'terms.html'),
          support: resolve(__dirname, 'support.html'),
          contact: resolve(__dirname, 'contact.html'),
          '404': resolve(__dirname, '404.html'),
          'admin-login': resolve(__dirname, 'admin/login.html'),
          'admin-dashboard': resolve(__dirname, 'admin/dashboard.html'),
          'admin-inventory': resolve(__dirname, 'admin/inventory.html'),
          'admin-orders': resolve(__dirname, 'admin/orders.html'),
          'admin-pos': resolve(__dirname, 'admin/pos.html'),
          'admin-admins': resolve(__dirname, 'admin/admins.html'),
          'admin-tasks': resolve(__dirname, 'admin/tasks.html'),
          'admin-expenses': resolve(__dirname, 'admin/expenses.html'),
          'admin-todo': resolve(__dirname, 'admin/todo.html'),
          'admin-settings': resolve(__dirname, 'admin/settings.html'),
          'admin-cms': resolve(__dirname, 'admin/cms.html'),
          'admin-support': resolve(__dirname, 'admin/support.html'),
        },
      },
    },
  }
})
