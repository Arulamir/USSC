'use client'

import { useEffect, useState } from 'react'
import { useTheme } from './Theme'
import { ApiService } from '../../../lib/api'

type NavbarProps = {
  title?: string
  subtitle?: string
  onMenuClick: () => void
}

type WeatherInfo = {
  temp: number | null
  humidity: number | null
  code: number
}

export default function Navbar({ onMenuClick }: NavbarProps) {
  const { theme, toggleTheme } = useTheme()
  const darkMode = theme === 'dark'
  
  const [weather, setWeather] = useState<WeatherInfo>({
    temp: null,
    humidity: null,
    code: 1,
  })

  useEffect(() => {
    let isMounted = true

    async function fetchWeatherWithRetry(retries = 3, delayMs = 3000) {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const res = await ApiService.getSurabayaWeather()
          if (isMounted && res?.current) {
            setWeather({
              temp: Number(res.current.temperature_2m) || null,
              humidity: Number(res.current.relative_humidity_2m) || null,
              code: Number(res.current.weather_code ?? 1),
            })
          }
          return // berhasil, stop retry
        } catch (err) {
          console.warn(`[Navbar] Gagal mengambil cuaca (percobaan ${attempt}/${retries}):`, err)
          if (attempt < retries && isMounted) {
            await new Promise((resolve) => setTimeout(resolve, delayMs))
          }
        }
      }
    }

    fetchWeatherWithRetry()
    const interval = setInterval(() => fetchWeatherWithRetry(), 10 * 60 * 1000)
    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [])

  // Icon & deskripsi cuaca Surabaya
  let weatherIcon = 'bi-cloud-sun-fill text-amber-500'
  let weatherText = 'Cerah Berawan'

  if (weather.code === 0) {
    weatherIcon = 'bi-sun-fill text-amber-500'
    weatherText = 'Cerah'
  } else if ([1, 2, 3].includes(weather.code)) {
    weatherIcon = 'bi-cloud-sun-fill text-amber-500'
    weatherText = 'Cerah Berawan'
  } else if ([45, 48].includes(weather.code)) {
    weatherIcon = 'bi-cloud-fog2-fill text-slate-400'
    weatherText = 'Berkabut'
  } else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(weather.code)) {
    weatherIcon = 'bi-cloud-rain-fill text-sky-500'
    weatherText = 'Hujan'
  } else if ([95, 96, 99].includes(weather.code)) {
    weatherIcon = 'bi-cloud-lightning-rain-fill text-purple-500'
    weatherText = 'Badai Petir'
  }

  return (
    <header
      className={`sticky top-0 z-30 border-b backdrop-blur-md transition-colors duration-300 ${
        darkMode ? 'border-slate-700/80 bg-slate-900/95' : 'border-slate-200/80 bg-white/95'
      }`}
    >
      <div className="flex h-[70px] sm:h-[78px] items-center justify-between px-4 sm:px-5 lg:px-8">
        <div className="flex items-center gap-2.5 sm:gap-4 min-w-0 flex-1 mr-2 sm:mr-4">
          <button
            onClick={onMenuClick}
            className={`flex h-9 w-9 sm:h-10 sm:w-10 flex-shrink-0 items-center justify-center rounded-xl border transition-colors lg:hidden ${
              darkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
            aria-label="Buka menu"
          >
            <i className="bi bi-list text-xl" />
          </button>

          <div className="min-w-0">
            <h1 className={`text-sm font-bold truncate sm:hidden ${darkMode ? 'text-white' : 'text-slate-900'}`}>Smart Sustainability Campus</h1>
            <p className={`text-[11px] truncate sm:hidden ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Monitoring Lingkungan Kampus UNESA</p>

            <h1 className={`hidden sm:block text-base lg:text-lg font-bold truncate ${darkMode ? 'text-white' : 'text-slate-900'}`}>
              UNESA Smart Sustainability Campus
            </h1>
            <p className={`hidden sm:block text-xs truncate ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              Monitoring Lingkungan Kampus Universitas Negeri Surabaya
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          {/* <p>Surabaya</p> */}
          <div
            className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-full border text-xs sm:text-[13px] font-semibold transition-all duration-200 shadow-sm cursor-default ${
              darkMode
                ? 'bg-slate-800/90 border-slate-700 text-slate-200 hover:bg-slate-800'
                : 'bg-emerald-50/90 border-emerald-200/80 text-emerald-900 hover:bg-emerald-100/70'
            }`}
            title={`Cuaca Surabaya (Open-Meteo): ${weatherText} (${
              weather.temp !== null ? `\${weather.temp.toFixed(1)} °C` : '-- °C'
            }${weather.humidity !== null ? `, Kelembaban \${weather.humidity}%` : ''})`}
          >
            <i className={`bi ${weatherIcon} text-sm sm:text-base`} />
            <span className="tabular-nums font-semibold">{weather.temp !== null ? `${weather.temp.toFixed(1)} °C` : '-- °C'}</span>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className={`flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl transition-all duration-200 ${
              darkMode
                ? 'bg-slate-800 text-amber-400 hover:bg-slate-700 border border-slate-700 shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 shadow-sm'
            }`}
            aria-label={darkMode ? 'Aktifkan light mode' : 'Aktifkan dark mode'}
            title={darkMode ? 'Light Mode' : 'Dark Mode'}
          >
            <i className={`bi ${darkMode ? 'bi-sun-fill text-amber-400' : 'bi-moon-fill text-slate-700'} text-base sm:text-lg`} />
          </button>
        </div>
      </div>
    </header>
  )
}
