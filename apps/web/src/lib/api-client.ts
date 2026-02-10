/**
 * Client-side API client with automatic token refresh.
 * Used in Client Components via TanStack Query.
 */

class ApiClient {
  private refreshPromise: Promise<void> | null = null;
  private baseUrl: string;

  constructor(baseUrl = '/api/v1') {
    this.baseUrl = baseUrl;
  }

  async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (response.status === 401) {
      if (!this.refreshPromise) {
        this.refreshPromise = this.refresh();
      }
      await this.refreshPromise;
      this.refreshPromise = null;

      const retryResponse = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (retryResponse.status === 401) {
        window.location.href = '/login';
        throw new Error('Session expired');
      }

      return retryResponse.json() as Promise<T>;
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
      throw new ApiError(response.status, error);
    }

    return response.json() as Promise<T>;
  }

  private async refresh(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) throw new Error('Refresh failed');
  }

  // Convenience methods
  get<T>(path: string) {
    return this.fetch<T>(path);
  }

  post<T>(path: string, body?: unknown) {
    return this.fetch<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  patch<T>(path: string, body?: unknown) {
    return this.fetch<T>(path, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(path: string) {
    return this.fetch<T>(path, { method: 'DELETE' });
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API Error ${status}`);
    this.name = 'ApiError';
  }
}

export const api = new ApiClient();
