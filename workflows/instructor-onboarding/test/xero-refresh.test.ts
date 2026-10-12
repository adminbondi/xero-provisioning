import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createLivePorts, type LiveEnv } from "../src/host/http.ts";
import {
  createOauthSession,
  kvRefreshTokenStore,
  sharedOauthAccessToken,
  XERO_REFRESH_KV_KEY,
  type RefreshTokenStore,
} from "../src/host/xero-refresh.ts";

const TOKEN_URL = "https://identity.xero.com/connect/token";
const SENTINELS = ["stale-secret", "store-live-token", "rotated-refresh-token", "consumed-refresh-token", "replacement-refresh-token"];

function assertNoSentinels(message: string) {
  for (const sentinel of SENTINELS) assert.equal(message.includes(sentinel), false, sentinel);
}

function memoryStore(initial = ""): RefreshTokenStore & { value: string; puts: number; script: string[]; readback: string | null } {
  const state = { value: initial, puts: 0, script: [] as string[], readback: null as string | null };
  return {
    get value() {
      return state.value;
    },
    set value(next: string) {
      state.value = next;
    },
    get puts() {
      return state.puts;
    },
    script: state.script,
    get readback() {
      return state.readback;
    },
    set readback(next: string | null) {
      state.readback = next;
    },
    async readRefreshToken() {
      if (state.script.length > 0) return state.script.shift() ?? "";
      return state.value;
    },
    async persistRefreshToken(refreshToken: string) {
      const token = refreshToken.trim();
      if (!token) throw new Error("Refusing to persist an empty XERO_REFRESH_TOKEN.");
      state.value = token;
      state.puts += 1;
      const verified = state.readback ?? state.value;
      state.readback = null;
      if (verified !== token) {
        throw new Error("Persisted XERO_REFRESH_TOKEN but the value read back did not match. Aborting before any Xero API work.");
      }
      return verified;
    },
  };
}

function tokenResponse(access = "oauth-access-token", refresh: string | null = "rotated-refresh-token", status = 200): Response {
  const payload: Record<string, string> = { access_token: access, token_type: "Bearer", expires_in: "1800" };
  if (refresh != null) payload.refresh_token = refresh;
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

test("a rotated refresh token is persisted and the next call reads KV before the secret", async () => {
  const store = memoryStore("");
  const kv = new Map<string, string>();
  const binding = kvRefreshTokenStore({
    async get(key) {
      return kv.get(key) ?? null;
    },
    async put(key, value) {
      kv.set(key, value);
    },
  });
  assert.equal(XERO_REFRESH_KV_KEY, "xero-refresh-token");
  assert.equal(XERO_REFRESH_KV_KEY.includes("created-after"), false);

  let presented = "";
  const fetchImpl: typeof fetch = async (_input, init) => {
    presented = new URLSearchParams(String(init?.body)).get("refresh_token") ?? "";
    return tokenResponse();
  };
  const first = await sharedOauthAccessToken({
    fetch: fetchImpl,
    tokenUrl: TOKEN_URL,
    clientId: "client-id",
    clientSecret: "client-secret",
    secretFallback: "stale-secret",
    store: binding,
    session: createOauthSession(),
  });
  assert.equal(first, "oauth-access-token");
  assert.equal(presented, "stale-secret");
  assert.equal(kv.get(XERO_REFRESH_KV_KEY), "rotated-refresh-token");

  const secondSession = createOauthSession();
  const fetchAgain: typeof fetch = async (_input, init) => {
    presented = new URLSearchParams(String(init?.body)).get("refresh_token") ?? "";
    return tokenResponse("oauth-access-token", "rotated-refresh-token");
  };
  const second = await sharedOauthAccessToken({
    fetch: fetchAgain,
    tokenUrl: TOKEN_URL,
    clientId: "client-id",
    clientSecret: "client-secret",
    secretFallback: "stale-secret",
    store: binding,
    session: secondSession,
  });
  assert.equal(second, "oauth-access-token");
  assert.equal(presented, "rotated-refresh-token");
  assert.notEqual(presented, "stale-secret");
  assert.equal(store.puts, 0);
});

test("concurrent steps share one refresh and do not drop the newer token", async () => {
  const store = memoryStore("store-live-token");
  const session = createOauthSession();
  let posts = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const fetchImpl: typeof fetch = async () => {
    posts += 1;
    if (posts === 1) {
      entered();
      await gate;
    }
    return tokenResponse("oauth-access-token", "rotated-refresh-token");
  };
  const options = {
    fetch: fetchImpl,
    tokenUrl: TOKEN_URL,
    clientId: "client-id",
    clientSecret: "client-secret",
    secretFallback: "stale-secret",
    store,
    session,
  };
  const first = sharedOauthAccessToken(options);
  await started;
  const second = sharedOauthAccessToken(options);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(posts, 1);
  release();
  const tokens = await Promise.all([first, second]);
  assert.deepEqual(tokens, ["oauth-access-token", "oauth-access-token"]);
  assert.equal(posts, 1);
  assert.equal(store.value, "rotated-refresh-token");
  assert.equal(store.puts, 1);
  assert.notEqual(store.value, "stale-secret");
  assert.notEqual(store.value, "store-live-token");
});

test("one invalid_grant re-reads the store and does not send the consumed token again", async () => {
  const store = memoryStore("consumed-refresh-token");
  store.script.push("consumed-refresh-token", "replacement-refresh-token");
  const sent: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const refresh = new URLSearchParams(String(init?.body)).get("refresh_token") ?? "";
    sent.push(refresh);
    if (refresh === "consumed-refresh-token") {
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    }
    return tokenResponse("oauth-access-token", "rotated-refresh-token");
  };
  const access = await sharedOauthAccessToken({
    fetch: fetchImpl,
    tokenUrl: TOKEN_URL,
    clientId: "client-id",
    clientSecret: "client-secret",
    secretFallback: "stale-secret",
    store,
    session: createOauthSession(),
  });
  assert.equal(access, "oauth-access-token");
  assert.deepEqual(sent, ["consumed-refresh-token", "replacement-refresh-token"]);
  assert.equal(store.value, "rotated-refresh-token");
  assert.equal(sent.includes("stale-secret"), false);
});

test("a read-back mismatch aborts before the access token is cached", async () => {
  const store = memoryStore("store-live-token");
  store.readback = "mismatched-readback";
  const session = createOauthSession();
  const fetchImpl: typeof fetch = async () => tokenResponse();
  await assert.rejects(
    () =>
      sharedOauthAccessToken({
        fetch: fetchImpl,
        tokenUrl: TOKEN_URL,
        clientId: "client-id",
        clientSecret: "client-secret",
        secretFallback: "stale-secret",
        store,
        session,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /did not match/);
      assertNoSentinels(error.message);
      return true;
    },
  );
  assert.equal(session.accessToken, null);
});

test("live ports persist a rotated token through KV before calling Xero", async () => {
  const env: LiveEnv = {
    AIRTABLE_TOKEN: "test-airtable-token",
    XERO_CLIENT_ID: "test-xero-client-id",
    XERO_CLIENT_SECRET: "test-xero-client-secret",
    XERO_REFRESH_TOKEN: "stale-secret",
    XERO_TENANT_ID: "test-xero-tenant",
    SLACK_BOT_TOKEN: "test-slack-bot-token",
    GMAIL_CLIENT_ID: "test-gmail-client-id",
    GMAIL_CLIENT_SECRET: "test-gmail-client-secret",
    GMAIL_REFRESH_TOKEN: "test-gmail-refresh-token",
  };
  const kv = new Map<string, string>([[XERO_REFRESH_KV_KEY, "store-live-token"]]);
  let xeroCalls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(TOKEN_URL)) {
      const refresh = new URLSearchParams(String(init?.body)).get("refresh_token");
      assert.equal(refresh, "store-live-token");
      return tokenResponse("test-xero-access-token", "rotated-refresh-token");
    }
    xeroCalls += 1;
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-xero-access-token");
    return Response.json({ PayrollCalendars: [] });
  };
  const ports = createLivePorts(env, fetchImpl, {
    xeroRefresh: kvRefreshTokenStore({
      async get(key) {
        return kv.get(key) ?? null;
      },
      async put(key, value) {
        kv.set(key, value);
      },
    }),
  });
  assert.deepEqual(await ports.employees.listPayrollCalendars(), []);
  assert.equal(xeroCalls, 1);
  assert.equal(kv.get(XERO_REFRESH_KV_KEY), "rotated-refresh-token");
});
