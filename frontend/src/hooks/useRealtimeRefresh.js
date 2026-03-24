import { useEffect, useRef } from 'react'

export default function useRealtimeRefresh(callback, options = {}) {
  const { enabled = true, intervalMs = 2000 } = options
  const runningRef = useRef(false)

  useEffect(() => {
    if (!enabled || typeof callback !== 'function') return undefined

    let cancelled = false

    const run = async () => {
      if (cancelled || document.hidden || runningRef.current) return
      runningRef.current = true
      try {
        await callback()
      } catch (err) {
        console.error(err)
      } finally {
        runningRef.current = false
      }
    }

    const onVisible = () => {
      if (!document.hidden) run()
    }

    const timer = window.setInterval(run, intervalMs)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [callback, enabled, intervalMs])
}
