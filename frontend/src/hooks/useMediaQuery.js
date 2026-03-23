import { useEffect, useState } from 'react'

export default function useMediaQuery(query) {
  const getMatch = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    return window.matchMedia(query).matches
  }

  const [matches, setMatches] = useState(getMatch)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined
    }

    const media = window.matchMedia(query)
    const handler = (event) => setMatches(event.matches)
    setMatches(media.matches)

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handler)
      return () => media.removeEventListener('change', handler)
    }

    media.addListener(handler)
    return () => media.removeListener(handler)
  }, [query])

  return matches
}
