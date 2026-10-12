import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSlackPort, slackOnceKey, type SlackOnceStore } from "../src/host/http.ts";

function memoryStore(): SlackOnceStore & { keys: string[] } {
  const values = new Map<string, string>();
  return {
    keys: [],
    async get(key) {
      return values.get(key) ?? null;
    },
    async put(key, value) {
      values.set(key, value);
      this.keys.push(key);
    },
    async delete(key) {
      values.delete(key);
    },
  };
}

test("the same Slack text is posted once, and the claim does not store the text", async () => {
  const store = memoryStore();
  let posts = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    posts += 1;
    const body = JSON.parse(String(init?.body)) as { text: string };
    assert.equal(body.text.includes("DO-NOT-STORE"), true);
    return Response.json({ ok: true, ts: "1.2" });
  };
  const text = "confirm the channel\nDO-NOT-STORE";
  const first = createSlackPort({ fetch: fetchImpl, token: "x", once: store });
  const second = createSlackPort({ fetch: fetchImpl, token: "x", once: store });
  assert.deepEqual(await first.postMessage({ channel: "C0C8CEZN64E", text }), { ts: "1.2" });
  assert.deepEqual(await first.postMessage({ channel: "C0C8CEZN64E", text }), { ts: "" });
  assert.deepEqual(await second.postMessage({ channel: "C0C8CEZN64E", text }), { ts: "" });
  assert.equal(posts, 1);
  assert.equal(store.keys.length, 1);
  assert.match(store.keys[0] ?? "", /^slack-once:[0-9a-f]{64}$/);
  assert.equal((store.keys[0] ?? "").includes("DO-NOT-STORE"), false);
  assert.equal((store.keys[0] ?? "").includes(text), false);
  assert.equal(await store.get(store.keys[0] ?? ""), "1");
  assert.equal(await slackOnceKey("C0C8CEZN64E", text), store.keys[0]);
});

test("a different Slack text still posts, and a failed post can be retried", async () => {
  const store = memoryStore();
  let posts = 0;
  const fetchImpl: typeof fetch = async () => {
    posts += 1;
    if (posts === 1) return Response.json({ ok: false, error: "internal_error" });
    return Response.json({ ok: true, ts: "9.9" });
  };
  const port = createSlackPort({ fetch: fetchImpl, token: "x", once: store });
  await assert.rejects(() => port.postMessage({ channel: "C", text: "one" }), /internal_error/);
  assert.deepEqual(await port.postMessage({ channel: "C", text: "one" }), { ts: "9.9" });
  assert.deepEqual(await port.postMessage({ channel: "C", text: "two" }), { ts: "9.9" });
  assert.equal(posts, 3);
});
