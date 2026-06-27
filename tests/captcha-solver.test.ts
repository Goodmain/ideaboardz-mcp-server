import test from "node:test";
import assert from "node:assert/strict";

import { TwoCaptchaSolver } from "../src/captcha-solver.js";

function installFetchMock(handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push(String(input));
    return handler(input, init);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test("solveRecaptchaV2 submits the task then polls until ready", async () => {
  let polls = 0;
  const mock = installFetchMock(async (input) => {
    const url = String(input);
    if (url.includes("/in.php")) {
      return new Response(JSON.stringify({ status: 1, request: "task-1" }), { status: 200 });
    }
    polls += 1;
    if (polls < 2) {
      return new Response(JSON.stringify({ status: 0, request: "CAPCHA_NOT_READY" }), { status: 200 });
    }
    return new Response(JSON.stringify({ status: 1, request: "the-token" }), { status: 200 });
  });

  try {
    const solver = new TwoCaptchaSolver({ apiKey: "key", pollIntervalMs: 0, sleep: async () => {} });
    const token = await solver.solveRecaptchaV2({ siteKey: "sk", pageUrl: "https://x.test/" });

    assert.equal(token, "the-token");
    assert.equal(polls, 2);
  } finally {
    mock.restore();
  }
});

test("solveRecaptchaV2 throws when the task is rejected on submit", async () => {
  const mock = installFetchMock(async () =>
    new Response(JSON.stringify({ status: 0, request: "ERROR_WRONG_USER_KEY" }), { status: 200 }),
  );

  try {
    const solver = new TwoCaptchaSolver({ apiKey: "key", pollIntervalMs: 0, sleep: async () => {} });
    await assert.rejects(
      () => solver.solveRecaptchaV2({ siteKey: "sk", pageUrl: "https://x.test/" }),
      /ERROR_WRONG_USER_KEY/,
    );
  } finally {
    mock.restore();
  }
});

test("solveRecaptchaV2 throws on a solving error during polling", async () => {
  const mock = installFetchMock(async (input) => {
    const url = String(input);
    if (url.includes("/in.php")) {
      return new Response(JSON.stringify({ status: 1, request: "task-1" }), { status: 200 });
    }
    return new Response(JSON.stringify({ status: 0, request: "ERROR_CAPTCHA_UNSOLVABLE" }), { status: 200 });
  });

  try {
    const solver = new TwoCaptchaSolver({ apiKey: "key", pollIntervalMs: 0, sleep: async () => {} });
    await assert.rejects(
      () => solver.solveRecaptchaV2({ siteKey: "sk", pageUrl: "https://x.test/" }),
      /ERROR_CAPTCHA_UNSOLVABLE/,
    );
  } finally {
    mock.restore();
  }
});

test("constructor requires an API key", () => {
  assert.throws(() => new TwoCaptchaSolver({ apiKey: "" }), /API key is required/);
});
