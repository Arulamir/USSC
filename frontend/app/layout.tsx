import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './globals.css'
import { ThemeProvider } from './components/layout/Theme'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Smart Sustainability Campus',
  description: 'Smart Sustainability Campus - Universitas Negeri Surabaya',
  icons: {
    icon: '/assets/img/logoweb.png',
    shortcut: '/assets/img/logoweb.png',
    apple: '/assets/img/logoweb.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="id">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
