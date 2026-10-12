export const GOOGLE_CALLBACK_PATH = "/oauth/google/callback";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const WORKER_SCRIPT_NAME = "instructor-onboarding";

export interface GoogleCallbackDeps {
  clientId: string;
  clientSecret: string;
  fetch: typeof fetch;
  canSave: boolean;
  saveRefreshToken(refreshToken: string): Promise<void>;
  log?(outcome: string): void;
}

function logOutcome(deps: GoogleCallbackDeps, outcome: string): void {
  if (deps.log) {
    deps.log(outcome);
    return;
  }
  console.log(JSON.stringify({ event: "google-oauth-callback", outcome }));
}

/**
 * Exchanges a Google authorization code and stores the refresh token as the
 * Worker secret GMAIL_REFRESH_TOKEN. The code and the refresh token are not
 * written to the response or the log.
 */
export async function handleGoogleCallback(request: Request, deps: GoogleCallbackDeps): Promise<Response> {
  if (request.method !== "GET") {
    return Response.json({ error: "GET only." }, { status: 405 });
  }
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) {
    logOutcome(deps, "denied");
    return Response.json({ error: "Google did not authorize Gmail." }, { status: 400 });
  }
  if (!code) {
    logOutcome(deps, "missing-code");
    return Response.json({ error: "Missing authorization code." }, { status: 400 });
  }
  if (!deps.clientId || !deps.clientSecret) {
    logOutcome(deps, "client-not-configured");
    return Response.json({ error: "Gmail OAuth client is not configured." }, { status: 503 });
  }
  if (!deps.canSave) {
    logOutcome(deps, "save-not-configured");
    return Response.json({ error: "Gmail refresh token cannot be saved yet." }, { status: 503 });
  }

  let refreshToken: string;
  try {
    refreshToken = await exchangeAuthorizationCode({
      fetch: deps.fetch,
      clientId: deps.clientId,
      clientSecret: deps.clientSecret,
      code,
      redirectUri: new URL(GOOGLE_CALLBACK_PATH, url.origin).toString(),
    });
  } catch {
    logOutcome(deps, "exchange-failed");
    return Response.json({ error: "Gmail authorization could not be completed." }, { status: 502 });
  }

  try {
    await deps.saveRefreshToken(refreshToken);
  } catch {
    logOutcome(deps, "save-failed");
    return Response.json({ error: "Gmail authorization could not be saved." }, { status: 502 });
  }

  logOutcome(deps, "saved");
  return new Response("Gmail is connected. You can close this page.", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function exchangeAuthorizationCode(input: {
  fetch: typeof fetch;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<string> {
  const response = await input.fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error("token-endpoint-rejected");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("token-endpoint-not-json");
  }
  const refreshToken =
    parsed && typeof parsed === "object" && typeof (parsed as { refresh_token?: unknown }).refresh_token === "string"
      ? (parsed as { refresh_token: string }).refresh_token
      : "";
  if (!refreshToken) {
    throw new Error("no-refresh-token");
  }
  return refreshToken;
}

/** Writes GMAIL_REFRESH_TOKEN onto this Worker. Does not include the token in errors. */
export async function saveGmailRefreshToken(input: {
  fetch: typeof fetch;
  accountId: string;
  scriptName: string;
  apiToken: string;
  refreshToken: string;
}): Promise<void> {
  if (!input.apiToken || !input.accountId) {
    throw new Error("Cloudflare API credentials are not configured.");
  }
  const response = await input.fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/workers/scripts/${encodeURIComponent(input.scriptName)}/secrets`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${input.apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "GMAIL_REFRESH_TOKEN",
        text: input.refreshToken,
        type: "secret_text",
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Cloudflare secret update failed (${response.status}).`);
  }
  await response.text();
}
