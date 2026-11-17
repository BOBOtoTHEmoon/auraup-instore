import type { Metadata, Viewport } from "next";
import { Archivo, Space_Mono, Montserrat } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-body",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
  display: "swap",
});

// The brand wordmark font, matching the Shopify store. Full weight range so the
// AURAUP letters can ramp from light to heavy.
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-brand",
  display: "swap", 
});

export const metadata: Metadata = {
  title: "AuraUp In-Store",
  description: "In-store sales for AuraUp, Westbrook Mall Lekki",
  // Lets staff add it to the phone home screen and open it fullscreen
  appleWebApp: { capable: true, title: "AuraUp", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Staff are tapping fast at a counter; accidental double-tap zoom is a pain
  maximumScale: 1,
  themeColor: "#EBEAE4",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${archivo.variable} ${spaceMono.variable} ${montserrat.variable}`}>
      <body>{children}</body>
    </html>
  );
}
