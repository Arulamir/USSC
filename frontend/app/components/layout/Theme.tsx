'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type Theme = 'light' | 'dark'

type ThemeContextType = {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    const savedTheme = localStorage.getItem('ussc-theme')

    if (savedTheme === 'dark') {
      setTheme('dark')
      document.documentElement.classList.add('dark')
    } else {
      setTheme('light')
      document.documentElement.classList.remove('dark')
    }
  }, [])

  const toggleTheme = () => {
    setTheme((currentTheme) => {
      const newTheme = currentTheme === 'light' ? 'dark' : 'light'

      if (newTheme === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }

      localStorage.setItem('ussc-theme', newTheme)

      return newTheme
    })
  }

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error('useTheme harus digunakan di dalam ThemeProvider')
  }

  return context
}
