import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from 'next-themes';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { MockBanner } from '@/components/layout/mock-banner';
import { Providers } from '@/components/layout/providers';
import { OperatorProvider } from '@/lib/operator';
import { getSessionOperator } from '@/server/session-user';
import { Toaster } from '@/components/ui/sonner';
import { DensityEffect } from '@/components/layout/settings-panel';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getEnvironment } from '@/lib/environment';
import { PRODUCT_NAME } from '@/components/layout/navigation';
import './globals.css';

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s | ${PRODUCT_NAME}` },
  description: 'Operator console for PayBridge.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

// The mock-mode banner reads the server environment at request time, never the build.
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  const operator = await getSessionOperator();
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>
            {/* Providers wraps the sidebar too: its Exceptions badge is a query. */}
            <Providers>
              {operator ? (
                <OperatorProvider operator={operator}>
                  <SidebarProvider>
                    <DensityEffect />
                    <AppSidebar />
                    <SidebarInset className="min-w-0 overflow-x-hidden">
                      {getEnvironment().mockMode && <MockBanner />}
                      {children}
                      {modal}
                    </SidebarInset>
                  </SidebarProvider>
                </OperatorProvider>
              ) : (
                // Nobody is signed in: only the sign-in page, without the shell.
                children
              )}
              <Toaster />
            </Providers>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
