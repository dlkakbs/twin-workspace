import { useEffect } from 'react'
import { useStore } from '../store'

// Syncs the Zustand theme state to the <html> class
export function useTheme() {
  const theme = useStore((s) => s.theme)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  return theme
}
