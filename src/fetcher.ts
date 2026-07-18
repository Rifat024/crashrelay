export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export const realFetcher: Fetcher = (url, init) => globalThis.fetch(url, init) as ReturnType<Fetcher>;
