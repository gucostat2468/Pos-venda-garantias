self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

function buildNotificationPayload(data) {
  const title = data?.titulo || 'Nova atualização na esteira'
  const body = data?.mensagem || 'Você recebeu uma atualização do fluxo de garantias.'
  const caseId = data?.case_id || null
  const url = data?.url || (caseId ? `/casos/${caseId}` : '/casos')
  return {
    title,
    options: {
      body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: {
        url,
        case_id: caseId,
        notificacao_id: data?.id || null,
      },
      tag: caseId ? `caso-${caseId}` : `notif-${Date.now()}`,
      renotify: true,
      requireInteraction: false,
    },
  }
}

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (err) {
    data = {}
  }
  const payload = buildNotificationPayload(data)
  event.waitUntil(
    self.registration.showNotification(payload.title, payload.options)
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification?.data?.url || '/casos'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'push_notification_click', url: targetUrl })
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
      return Promise.resolve()
    })
  )
})
