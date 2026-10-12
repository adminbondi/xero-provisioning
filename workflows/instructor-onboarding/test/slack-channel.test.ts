import "./block-network.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { SLACK_CHANNEL_ID, slackChannelForRun } from "../src/config.ts";

test("dry-run and live Slack channels come from env and do not fall through", () => {
  assert.equal(
    slackChannelForRun({ SLACK_DRY_RUN_CHANNEL_ID: "C-TEST-ALERTS", SLACK_CHANNEL_ID: SLACK_CHANNEL_ID }, true),
    "C-TEST-ALERTS",
  );
  assert.equal(
    slackChannelForRun({ SLACK_DRY_RUN_CHANNEL_ID: "C-TEST-ALERTS", SLACK_CHANNEL_ID: SLACK_CHANNEL_ID }, false),
    SLACK_CHANNEL_ID,
  );
  assert.throws(() => slackChannelForRun({ SLACK_CHANNEL_ID }, true), /SLACK_DRY_RUN_CHANNEL_ID is not set/);
  assert.throws(() => slackChannelForRun({ SLACK_DRY_RUN_CHANNEL_ID: "C-TEST-ALERTS" }, false), /SLACK_CHANNEL_ID is not set/);
  assert.throws(() => slackChannelForRun({}, true), /SLACK_DRY_RUN_CHANNEL_ID is not set/);
});
