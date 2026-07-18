import type { Defect, TicketRef } from '../types';

export interface TicketProvider {
  name: string;
  createTicket(defect: Defect): Promise<TicketRef>;
  addComment(ticket: TicketRef, text: string): Promise<void>;
  /** Lightweight read-only call used by `crashrelay test-ticket --dry-run` to verify credentials without creating anything. */
  checkConnection(): Promise<void>;
}
