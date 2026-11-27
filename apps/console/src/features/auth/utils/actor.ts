import type { StatusTransition } from '@/features/payments/schemas';

/** Who acted: platform staff are labelled as such, with their name. */
export function actorText(transition: Pick<StatusTransition, 'actor' | 'actorName' | 'actorLabel'>): string {
  if (!transition.actorLabel) return transition.actor;
  return transition.actorName ? `${transition.actorLabel}: ${transition.actorName}` : transition.actorLabel;
}
