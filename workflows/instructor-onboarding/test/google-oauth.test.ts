/**
 * Gmail OAuth callback. Injected fetch only. No live Google or Cloudflare calls.
 */
import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { handleGoogleCallback, saveGmailRefreshToken } from "../src/host/google-oauth.ts";

const CODE = "test-auth-code";
const REFRESH = "test-refresh-token";
const CLIENT = "test-gmail-client-id";
const SECRET = "test-gmail-client-secret";

function callbackUrl(query = ""): string {
  return `https://instructor-onboarding.example/oauth/google/callback${query}`;
}

test("a missing authorization code does not call Google", async () => {
  let called = false;
  const logs: string[] = [];
  const response = await handleGoogleCallback(new Request(callbackUrl()), {
    clientId: CLIENT,
    clientSecret: SECRET,
    canSave: true,
    fetch: async () => {
      called = true;
      throw new Error("fetch should not run");
    },
    saveRefreshToken: async () => {
      throw new Error("save should not run");
    },
    log: (outcome) => logs.push(outcome),
  });
  assert.equal(response.status, 400);
  assert.equal(called, false);
  assert.deepEqual(logs, ["missing-code"]);
  const body = await response.text();
  assert.match(body, /Missing authorization code/);
  assert.equal(body.includes(CODE), false);
  assert.equal(body.includes(REFRESH), false);
});

test("the exchange is refused until the Gmail client secrets exist", async () => {
  let called = false;
  const response = await handleGoogleCallback(new Request(callbackUrl(`?code=${CODE}`)), {
    clientId: "",
    clientSecret: "",
    canSave: true,
    fetch: async () => {
      called = true;
      throw new Error("fetch should not run");
    },
    saveRefreshToken: async () => undefined,
  });
  assert.equal(response.status, 503);
  assert.equal(called, false);
  const body = await response.text();
  assert.match(body, /not configured/);
  assert.equal(body.includes(CODE), false);
});

test("a successful exchange saves the refresh token and does not return it", async () => {
  const seen: string[] = [];
  let saved = "";
  const logs: string[] = [];
  const response = await handleGoogleCallback(new Request(callbackUrl(`?code=${CODE}`)), {
    clientId: CLIENT,
    clientSecret: SECRET,
    canSave: true,
    fetch: async (_input, init) => {
      const body = String(init?.body ?? "");
      seen.push(body);
      assert.equal(body.includes(CODE), true);
      assert.equal(body.includes(CLIENT), true);
      return Response.json({ refresh_token: REFRESH, access_token: "test-access-token" });
    },
    saveRefreshToken: async (refreshToken) => {
      saved = refreshToken;
    },
    log: (outcome) => logs.push(outcome),
  });
  assert.equal(response.status, 200);
  assert.equal(saved, REFRESH);
  assert.deepEqual(logs, ["saved"]);
  assert.equal(logs.some((line) => line.includes(CODE) || line.includes(REFRESH)), false);
  const body = await response.text();
  assert.match(body, /Gmail is connected/);
  assert.equal(body.includes(CODE), false);
  assert.equal(body.includes(REFRESH), false);
  assert.equal(body.includes("test-access-token"), false);
});

test("a rejected token response does not echo Google's body", async () => {
  const response = await handleGoogleCallback(new Request(callbackUrl(`?code=${CODE}`)), {
    clientId: CLIENT,
    clientSecret: SECRET,
    canSave: true,
    fetch: async () => new Response(`secret-body ${CODE} ${REFRESH}`, { status: 400 }),
    saveRefreshToken: async () => {
      throw new Error("save should not run");
    },
  });
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.equal(body.includes(CODE), false);
  assert.equal(body.includes(REFRESH), false);
  assert.equal(body.includes("secret-body"), false);
});

test("saving the refresh token names GMAIL_REFRESH_TOKEN and hides it from errors", async () => {
  let savedBody = "";
  await saveGmailRefreshToken({
    accountId: "account-1",
    scriptName: "instructor-onboarding",
    apiToken: "test-api-token",
    refreshToken: REFRESH,
    fetch: async (input, init) => {
      assert.equal(String(input), "https://api.cloudflare.com/client/v4/accounts/account-1/workers/scripts/instructor-onboarding/secrets");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-api-token");
      savedBody = String(init?.body ?? "");
      return Response.json({ success: true });
    },
  });
  const parsed = JSON.parse(savedBody) as { name: string; text: string; type: string };
  assert.equal(parsed.name, "GMAIL_REFRESH_TOKEN");
  assert.equal(parsed.text, REFRESH);
  assert.equal(parsed.type, "secret_text");

  await assert.rejects(
    () =>
      saveGmailRefreshToken({
        accountId: "account-1",
        scriptName: "instructor-onboarding",
        apiToken: "test-api-token",
        refreshToken: REFRESH,
        fetch: async () => new Response(`leak ${REFRESH}`, { status: 500 }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(REFRESH), false);
      assert.match(error.message, /500/);
      return true;
    },
  );
});
