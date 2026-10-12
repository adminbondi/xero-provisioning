import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID } from "../src/config.ts";
import { bindFetch, createAirtablePort, refreshOAuthToken } from "../src/host/http.ts";

function unboundFetch(this: unknown, input: Parameters<typeof fetch>[0]): Promise<Response> {
  if (this !== globalThis) throw new TypeError("Illegal invocation");
  const url = input instanceof URL ? input.toString() : String(input);
  if (url.startsWith("https://identity.xero.com/connect/token")) {
    return Promise.resolve(Response.json({ access_token: "bound-token" }));
  }
  return Promise.resolve(Response.json({ records: [] }));
}

test("bindFetch calls fetch with the global this so a method call does not throw", async () => {
  const fetchImpl = unboundFetch as typeof fetch;
  const options = { fetch: fetchImpl };
  assert.throws(() => {
    options.fetch("https://example.test");
  }, /Illegal invocation/);
  const bound = bindFetch(fetchImpl);
  const response = await bound("https://example.test");
  assert.equal(await response.text(), "{\"records\":[]}");

  const token = await refreshOAuthToken(fetchImpl, "https://identity.xero.com/connect/token", {
    grant_type: "refresh_token",
  });
  assert.equal(token.accessToken, "bound-token");

  const airtable = createAirtablePort({ fetch: fetchImpl, token: "test-token" });
  const page = await airtable.listRecords({
    baseId: AIRTABLE_BASE_ID,
    tableId: AIRTABLE_TABLE_ID,
    includeAttachments: true,
    view: null,
    filterByFormula: null,
  });
  assert.deepEqual(page.records, []);
});
