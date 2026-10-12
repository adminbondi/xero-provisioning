globalThis.fetch = (() => {
  throw new Error("Tests refuse network access. Inject a fake fetch or in-memory ports.");
}) as typeof fetch;
