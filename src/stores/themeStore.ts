import { create } from 'zustand'

export type ThemePreference = 'light' | 'dark' | 'system'

interface ThemeState {
  preference: ThemePreference
  resolvedMode: 'light' | 'dark'
  setPreference: (pref: ThemePreference) => void
  init: () => void
}

function getSystemMode(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function applyTailwindDarkClass(mode: 'light' | 'dark') {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (mode === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: 'system',
  resolvedMode: 'light',
  setPreference: (pref) => {
    const systemMode = getSystemMode()
    const resolved = pref === 'system' ? systemMode : pref
    applyTailwindDarkClass(resolved)
    try {
      localStorage.setItem('theme-preference', pref)
    } catch {}
    set({ preference: pref, resolvedMode: resolved })
  },
  init: () => {
    let stored: ThemePreference | null = null
    try {
      const v = localStorage.getItem('theme-preference')
      if (v === 'light' || v === 'dark' || v === 'system') stored = v
    } catch {}
    const pref = stored ?? 'system'
    const systemMode = getSystemMode()
    const resolved = pref === 'system' ? systemMode : pref
    applyTailwindDarkClass(resolved)

    // Listen to changes in system preference when in system mode
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const listener = () => {
        const currentPref = get().preference
        if (currentPref === 'system') {
          const mode = getSystemMode()
          applyTailwindDarkClass(mode)
          set({ resolvedMode: mode })
        }
      }
      try {
        mq.addEventListener?.('change', listener)
      } catch {
        // Safari
        // @ts-expect-error legacy API
        mq.addListener?.(listener)
      }
    }

    set({ preference: pref, resolvedMode: resolved })
  }
}))


