import React from "react"
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const _geist = Geist({ subsets: ["latin"], preload: false  });
const _geistMono = Geist_Mono({ subsets: ["latin"], preload: false});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL!),
  title: 'Turbo Kart Racing',
  description: 'A fun 3D kart racing game built with React Three Fiber',
  applicationName: 'Turbo Kart Racing',
  generator: 'v0.app',
  keywords: ['kart', 'racing', 'multiplayer', '3d', 'react three fiber', 'turbo kart'],
  openGraph: {
    title: 'Turbo Kart Racing',
    description: 'Fast-paced 3D kart racing built with React Three Fiber.',
    type: 'website',
    images: [
      {
        url: '/icon.svg',
        alt: 'Turbo Kart logo',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Turbo Kart Racing',
    description: 'Fast-paced 3D kart racing built with React Three Fiber.',
    images: ['/icon-light-32x32.png'],
  },
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      {/* <body className={`font-sans antialiased`}> */}
       
      <body className={`${_geist.className} ${_geistMono.className} font-sans antialiased`}>
        {children}
      </body>
    </html>
  )
}
