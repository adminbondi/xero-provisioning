/**
 * OAuth refresh-and-persist, following payroll
 * `balance-moves-jobs` `xero_api/token_store.py`:
 * `shared_oauth_access_token` and `RenderRefreshTokenStore.persist_refresh_token`.
 *
 * Payroll reads and writes the refresh token on Render. This Worker uses the
 * existing cursor KV as that store. The value is read before the
 * `XERO_REFRESH_TOKEN` secret. A rotated token is saved and read back before
 * the access token is cached. The token value is never logged.
 */

export const XERO_REFRESH_KV_KEY = "xero-refresh-token";

const DEFAULT_ACCESS_TOKEN_SECONDS = 1800;
const ACCESS_TOKEN_SKEW_MS = 60_000;

export interface RefreshTokenStore {
  /** Current stored refresh token. Empty when nothing has been persisted yet. */
  readRefreshToken(): Promise<string>;
  /** Save, read back, and return the verified token. Throw if that fails. */
  persistRefreshToken(refreshToken: string): Promise<string>;
}

export interface KvTokenBinding {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

/** Payroll `RenderRefreshTokenStore`, backed by KV instead of the Render env API. */
export function kvRefreshTokenStore(kv: KvTokenBinding, key = XERO_REFRESH_KV_KEY): RefreshTokenStore {
  return {
    async readRefreshToken() {
      return ((await kv.get(key)) ?? "").trim();
    },
    async persistRefreshToken(refreshToken: string) {
      const token = refreshToken.trim();
      if (!token) throw new Error("Refusing to persist an empty XERO_REFRESH_TOKEN.");
      await kv.put(key, token);
      let verified = "";
      try {
        verified = ((await kv.get(key)) ?? "").trim();
      } catch {
        throw new Error("Persisted XERO_REFRESH_TOKEN but could not read it back. Aborting before any Xero API work.");
      }
      if (verified !== token) {
        throw new Error(
          "Persisted XERO_REFRESH_TOKEN but the value read back did not match. Aborting before any Xero API work.",
        );
      }
      console.log(JSON.stringify({ event: "xero-refresh-persisted" }));
      return verified;
    },
  };
}

export interface OauthSession {
  accessToken: string | null;
  expiresAt: number;
  chain: Promise<void>;
}

/** In-isolate lock and access-token cache. Payroll uses a file lock and `access-token.json`. */
export function createOauthSession(): OauthSession {
  return { accessToken: null, expiresAt: 0, chain: Promise.resolve() };
}

/** Shared by requests in this isolate, the way payroll shares one refresh per container. */
export const isolateOauthSession = createOauthSession();

class InvalidGrant extends Error {
  constructor() {
    super("invalid_grant");
    this.name = "InvalidGrant";
  }
}

function exclusive<T>(session: OauthSession, task: () => Promise<T>): Promise<T> {
  const run = session.chain.then(task, task);
  session.chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function cachedAccessToken(session: OauthSession, now: number): string | null {
  if (!session.accessToken) return null;
  if (session.expiresAt - ACCESS_TOKEN_SKEW_MS <= now) return null;
  return session.accessToken;
}

function expiresInSeconds(payload: Record<string, unknown>): number {
  const raw = payload.expires_in;
  const seconds = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_ACCESS_TOKEN_SECONDS;
  return seconds;
}

function isInvalidGrant(status: number, body: string): boolean {
  if (status !== 400 && status !== 401) return false;
  try {
    const payload = JSON.parse(body) as { error?: unknown };
    return payload.error === "invalid_grant";
  } catch {
    return body.includes("invalid_grant");
  }
}

async function postRefresh(
  fetchImpl: typeof fetch,
  tokenUrl: string,
  headers: Headers,
  refreshToken: string,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(tokenUrl, {
    method: "POST",
    headers,
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const text = await response.text();
  if (isInvalidGrant(response.status, text)) throw new InvalidGrant();
  if (!response.ok) throw new Error(`Unexpected token response status: ${response.status}`);
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Xero token response did not include an access token.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Xero token response did not include an access token.");
  }
  return payload as Record<string, unknown>;
}

async function refreshWithOneRecovery(
  fetchImpl: typeof fetch,
  tokenUrl: string,
  headers: Headers,
  store: RefreshTokenStore,
  presented: string,
): Promise<{ payload: Record<string, unknown>; accepted: string }> {
  try {
    return { payload: await postRefresh(fetchImpl, tokenUrl, headers, presented), accepted: presented };
  } catch (error) {
    if (!(error instanceof InvalidGrant)) throw error;
  }
  const latest = (await store.readRefreshToken()).trim();
  if (!latest || latest === presented) {
    throw new Error(
      "Xero rejected the stored refresh token (invalid_grant). The token re-read from the store was unchanged, so it was not sent again.",
    );
  }
  console.log(JSON.stringify({ event: "xero-refresh-reread" }));
  try {
    return { payload: await postRefresh(fetchImpl, tokenUrl, headers, latest), accepted: latest };
  } catch (error) {
    if (error instanceof InvalidGrant) {
      throw new Error(
        "Xero rejected the stored refresh token (invalid_grant) again after one re-read. Aborting before any Xero API work.",
      );
    }
    throw error;
  }
}

export async function sharedOauthAccessToken(options: {
  fetch: typeof fetch;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Used only when the store has no token yet. Ignored once KV has a value. */
  secretFallback: string;
  store: RefreshTokenStore;
  session?: OauthSession;
  now?: () => number;
}): Promise<string> {
  const session = options.session ?? createOauthSession();
  const now = options.now ?? Date.now;
  const headers = new Headers({
    Authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  });
  return exclusive(session, async () => {
    const cached = cachedAccessToken(session, now());
    if (cached) return cached;
    const stored = (await options.store.readRefreshToken()).trim();
    const presented = stored || options.secretFallback.trim();
    if (!presented) throw new Error("XERO_REFRESH_TOKEN is not set.");
    const { payload, accepted } = await refreshWithOneRecovery(
      options.fetch,
      options.tokenUrl,
      headers,
      options.store,
      presented,
    );
    const rotated = typeof payload.refresh_token === "string" ? payload.refresh_token.trim() : "";
    if (rotated && rotated !== accepted) await options.store.persistRefreshToken(rotated);
    const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
    if (!accessToken) throw new Error("Xero token response did not include an access token.");
    session.accessToken = accessToken;
    session.expiresAt = now() + expiresInSeconds(payload) * 1000;
    return accessToken;
  });
}
