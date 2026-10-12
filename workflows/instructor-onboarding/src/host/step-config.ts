export const PIPELINE_STEPS = [
  "airtable-record",
  "super-fund",
  "gender",
  "xero-employee",
  "xero-employee-read",
  "xero-employee-finalise",
  "xero-contact",
  "slack",
  "email",
  "patty-webhook",
] as const;

export type PipelineStepName = (typeof PIPELINE_STEPS)[number];

export interface StepRetry {
  limit: number;
  delay: string;
  backoff: "constant" | "linear" | "exponential";
}

/** Per-step retry settings passed to Cloudflare Workflows `step.do`. */
export interface StepConfig {
  retries: StepRetry;
  timeout: string;
}

/**
 * Local steps are deterministic, so they do not retry.
 * Xero, Slack, and email each retry on their own. A failure does not re-run earlier steps.
 */
export const STEP_CONFIG: Record<PipelineStepName, StepConfig> = {
  "airtable-record": {
    retries: { limit: 0, delay: "1 second", backoff: "constant" },
    timeout: "15 seconds",
  },
  "super-fund": {
    retries: { limit: 0, delay: "1 second", backoff: "constant" },
    timeout: "15 seconds",
  },
  gender: {
    retries: { limit: 0, delay: "1 second", backoff: "constant" },
    timeout: "15 seconds",
  },
  "xero-employee": {
    retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
    timeout: "2 minutes",
  },
  "xero-employee-read": {
    retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
    timeout: "2 minutes",
  },
  "xero-employee-finalise": {
    retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
    timeout: "2 minutes",
  },
  "xero-contact": {
    retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
    timeout: "2 minutes",
  },
  slack: {
    retries: { limit: 5, delay: "15 seconds", backoff: "exponential" },
    timeout: "1 minute",
  },
  email: {
    retries: { limit: 5, delay: "15 seconds", backoff: "exponential" },
    timeout: "1 minute",
  },
  "patty-webhook": {
    retries: { limit: 5, delay: "15 seconds", backoff: "exponential" },
    timeout: "1 minute",
  },
};

export interface StepDo {
  do<T>(name: PipelineStepName, config: StepConfig, callback: () => Promise<T>): Promise<T>;
}
