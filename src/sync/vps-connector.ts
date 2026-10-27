/**
 * HTTP connector for a self-hosted tabbary sync server.
 *
 * No dependencies: fetch + AbortController, both available in the MV3 service
 * worker. Every request fails closed — a network error never looks like
 * "nothing to sync".
 */

import {
  SyncHttpError,
  type BlobType,
  type HealthResponse,
  type PairResponse,
  type PullResponse,
  type PushResponse,
  type SyncConnector,
} from './connector';

const TIMEOUT_MS = 15_000;

export class VpsConnector implements SyncConnector {
  private base: string;
  private token: string | null;

  constructor(endpoint: string, token: string | null = null) {
    // Normalise once so callers can pass "example.com" or a full URL.
    const withScheme = /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`;
    this.base = withScheme.replace(/\/+$/, '');
    this.token = token;
  }

  get origin(): string {
    return new URL(this.base).origin;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    auth = true,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${this.base}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(auth && this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...(init.headers ?? {}),
        },
      });

      let body: unknown = null;
      const text = await res.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }

      if (!res.ok) {
        const message =
          (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
        throw new SyncHttpError(res.status, message, body);
      }

      return body as T;
    } catch (err) {
      if (err instanceof SyncHttpError) throw err;
      if ((err as Error).name === 'AbortError') {
        throw new Error(`Timed out talking to ${this.base}`);
      }
      throw new Error(`Could not reach ${this.base}: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async ping(): Promise<HealthResponse | null> {
    return this.request<HealthResponse>('/health', { method: 'GET' }, false);
  }

  async pair(pairingSecret: string, deviceName: string): Promise<PairResponse> {
    const res = await this.request<PairResponse>(
      '/auth/pair',
      {
        method: 'POST',
        body: JSON.stringify({ pairingSecret, deviceName }),
      },
      false,
    );
    this.token = res.token;
    return res;
  }

  async me(): Promise<{ deviceId: string; name: string; revision: number }> {
    return this.request('/me');
  }

  async pull(since: number): Promise<PullResponse> {
    return this.request<PullResponse>(`/blobs?since=${Math.max(0, Math.floor(since))}`);
  }

  async push(blob: {
    id: string;
    type: BlobType;
    baseRevision: number;
    updatedAt: number;
    ciphertext: string;
    iv: string;
    deleted?: boolean;
  }): Promise<PushResponse> {
    return this.request<PushResponse>('/blobs', {
      method: 'POST',
      body: JSON.stringify({ blob }),
    });
  }

  async remove(id: string): Promise<void> {
    await this.request(`/blobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
