/**
 * Minimal typings for the Cloudflare modules this Worker imports.
 * Tests do not load those modules. Replace this with `wrangler types` before a deploy.
 */
declare module "cloudflare:workers" {
  interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
  }

  export interface WorkflowStepConfig {
    retries?: {
      limit: number;
      delay: string | number;
      backoff?: "constant" | "linear" | "exponential";
    };
    timeout?: string | number;
  }

  export interface WorkflowStep {
    do<T>(name: string, config: WorkflowStepConfig, callback: () => Promise<T>): Promise<T>;
  }

  export interface WorkflowEvent<T = unknown> {
    payload: T;
    instanceId: string;
    timestamp: Date;
  }

  export abstract class WorkflowEntrypoint<Env = unknown, T = unknown> {
    env: Env;
    constructor(ctx: ExecutionContext, env: Env);
    abstract run(event: WorkflowEvent<T>, step: WorkflowStep): Promise<unknown>;
  }

  export interface WorkflowInstance {
    id: string;
    status(): Promise<unknown>;
  }

  export interface WorkflowBinding<T = unknown> {
    create(options?: { id?: string; params?: T }): Promise<WorkflowInstance>;
    get(id: string): Promise<WorkflowInstance>;
  }

  export interface QueueBinding<T = unknown> {
    send(message: T): Promise<void>;
  }

  export interface QueueMessage<T = unknown> {
    body: T;
    ack(): void;
    retry(): void;
  }

  export interface MessageBatch<T = unknown> {
    messages: ReadonlyArray<QueueMessage<T>>;
  }
}

declare module "cloudflare:workflows" {
  export class NonRetryableError extends Error {
    constructor(message: string);
  }
}
