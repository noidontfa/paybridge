import { CheckCircle2Icon, CircleAlertIcon, FlaskConicalIcon, ZapIcon } from 'lucide-react';
import { CopyButton } from '@/components/copy-button';
import { Badge } from '@/components/ui/badge';
import type { GatewayMode, GatewaySummary } from '@/features/gateways/api';
import { TONE_CLASSES } from '@/components/status-badges';
import { cn } from '@/utils/cn';

/** Live is loud (solid red, bolt); test is quiet (neutral, flask), so real money is never mistaken for test traffic. */
export function GatewayModeBadge({ mode }: { mode: GatewayMode }) {
  const live = mode === 'live';
  const Icon = live ? ZapIcon : FlaskConicalIcon;
  return (
    <Badge
      data-mode={mode}
      variant="ghost"
      className={cn(live ? 'bg-red-600 font-semibold text-white dark:bg-red-500' : TONE_CLASSES.neutral)}
    >
      <Icon aria-hidden />
      {live ? 'Live' : 'Test'}
    </Badge>
  );
}

function StateBadge({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  const Icon = ok ? CheckCircle2Icon : CircleAlertIcon;
  return (
    <Badge variant="ghost" className={ok ? TONE_CLASSES.success : TONE_CLASSES.warning}>
      <Icon aria-hidden />
      {ok ? yes : no}
    </Badge>
  );
}

/** Registration, configuration, mode and the Callback URL, all exactly as the API reports them. */
export function GatewayFacts({ gateway }: { gateway: GatewaySummary }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StateBadge ok={gateway.registered} yes="Registered" no="Not registered" />
        <StateBadge ok={gateway.configured} yes="Configured" no="Not configured" />
        <GatewayModeBadge mode={gateway.mode} />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Callback URL</span>
        <div className="flex items-center gap-1">
          <code className="font-mono text-xs break-all">{gateway.callbackUrl}</code>
          <CopyButton value={gateway.callbackUrl} label="Callback URL" />
        </div>
      </div>
    </div>
  );
}
