import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from 'next-themes';
import { AppSidebar } from '@/components/app-sidebar';
import { MockBanner } from '@/components/mock-banner';
import { Providers } from '@/components/providers';
import { DensityEffect } from '@/components/settings-panel';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getEnvironment } from '@/lib/environment';
import { PRODUCT_NAME } from '@/lib/navigation';
import './globals.css';

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s | ${PRODUCT_NAME}` },
  description: 'Operator console for PayBridge.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

// The mock-mode banner reads the server environment at request time, never the build.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>
            {/* Providers wraps the sidebar too: its Exceptions badge is a query. */}
            <Providers>
              <SidebarProvider>
                <DensityEffect />
                <AppSidebar />
                <SidebarInset className="min-w-0 overflow-x-hidden">
                  {getEnvironment().mockMode && <MockBanner />}
                  {children}
                </SidebarInset>
              </SidebarProvider>
            </Providers>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
