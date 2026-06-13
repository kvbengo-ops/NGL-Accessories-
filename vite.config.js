import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        shop: resolve(__dirname, 'shop.html'),
        checkout: resolve(__dirname, 'checkout.html'),
        'order-confirm': resolve(__dirname, 'order-confirm.html'),
        'track-order': resolve(__dirname, 'track-order.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        terms: resolve(__dirname, 'terms.html'),
        support: resolve(__dirname, 'support.html'),
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
      },
    },
  },
})
