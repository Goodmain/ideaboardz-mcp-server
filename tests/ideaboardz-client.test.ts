import test from "node:test";
import assert from "node:assert/strict";

import { IdeaboardzClient, type Point } from "../src/ideaboardz-client.js";
import type { CaptchaSolver } from "../src/captcha-solver.js";

type FetchCall = {
  input: string | URL | Request;
  init?: RequestInit;
};

function installFetchMock(handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ input, init });
    return handler(input, init);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test("parseBoardRef parses shorthand references", () => {
  const client = new IdeaboardzClient();
  const ref = client.parseBoardRef("  team-retro/123  ");
  assert.equal(ref.id, "123");
  assert.equal(ref.name, "team-retro");
});

test("parseBoardRef parses full ideaboardz URL", () => {
  const client = new IdeaboardzClient();
  const ref = client.parseBoardRef("https://ideaboardz.com/for/team%20retro/board%2Fid");
  assert.equal(ref.id, "board/id");
  assert.equal(ref.name, "team retro");
});

test("parseBoardRef rejects invalid references", () => {
  const client = new IdeaboardzClient();
  assert.throws(() => client.parseBoardRef("not-valid"), /Board reference must be '<name>\/<id>'/);
  assert.throws(
    () => client.parseBoardRef("https://ideaboardz.com/invalid/path"),
    /Board URL must look like https:\/\/ideaboardz.com\/for\/<name>\/<id>/,
  );
});

test("getBoard returns parsed board sections from HTML", async () => {
  const mock = installFetchMock(async () => {
    const html = `
      <html>
        <body>
          <div class="section" id="section12">
            <h2 class="sectionTitle">Went Well</h2>
          </div>
          <div class="section" id="sectionbad">
            <h2 class="sectionTitle">Ignored</h2>
          </div>
          <div class="section" id="section34">
            <h2 class="sectionTitle">To Improve</h2>
          </div>
          <div class="section" id="section55"></div>
        </body>
      </html>
    `;

    return new Response(html, { status: 200 });
  });

  try {
    const client = new IdeaboardzClient("https://example.ideaboardz.test");
    const board = await client.getBoard({ name: "retro", id: "123" });

    assert.equal(board.id, "123");
    assert.equal(board.name, "retro");
    assert.deepEqual(board.sections, [
      { id: 12, title: "Went Well" },
      { id: 34, title: "To Improve" },
    ]);

    assert.equal(mock.calls.length, 1);
    assert.equal(String(mock.calls[0]?.input), "https://example.ideaboardz.test/for/retro/123");
  } finally {
    mock.restore();
  }
});

test("listPoints returns parsed JSON payload", async () => {
  const payload: Point[] = [{ id: 1, section_id: 2, message: "Hello", votes_count: 3 }];
  const mock = installFetchMock(async () => new Response(JSON.stringify(payload), { status: 200 }));

  try {
    const client = new IdeaboardzClient("https://example.ideaboardz.test");
    const points = await client.listPoints({ name: "retro", id: "123" });

    assert.deepEqual(points, payload);
    assert.equal(String(mock.calls[0]?.input), "https://example.ideaboardz.test/retros/retro/123/points.json");
  } finally {
    mock.restore();
  }
});

test("createPoint sends form data and parses non-JSON responses", async () => {
  const mock = installFetchMock(async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.ok(init?.body instanceof URLSearchParams);
    assert.equal(init?.body.get("point[message]"), "Ship demo");

    return new Response("accepted", { status: 200 });
  });

  try {
    const client = new IdeaboardzClient("https://example.ideaboardz.test");
    const result = await client.createPoint({ name: "retro", id: "123" }, 9, "Ship demo");

    assert.deepEqual(result, { raw: "accepted" });
    assert.equal(
      String(mock.calls[0]?.input),
      "https://example.ideaboardz.test/api/retros/123/retro/sections/9/points",
    );
  } finally {
    mock.restore();
  }
});

test("createBoard scrapes token, solves captcha, and returns the new board ref", async () => {
  const formHtml = `
    <form action="/retros" method="post">
      <input name="authenticity_token" value="csrf-123" />
      <div class="g-recaptcha" data-sitekey="site-key-abc"></div>
    </form>
  `;

  let solverCall: { siteKey: string; pageUrl: string } | undefined;
  const solver: CaptchaSolver = {
    async solveRecaptchaV2(params) {
      solverCall = params;
      return "captcha-token-xyz";
    },
  };

  const mock = installFetchMock(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/") && (!init || init.method === undefined)) {
      return new Response(formHtml, {
        status: 200,
        headers: { "set-cookie": "_session=abc; path=/; HttpOnly" },
      });
    }
    if (url.endsWith("/retros")) {
      assert.equal(init?.method, "POST");
      assert.ok(init?.body instanceof URLSearchParams);
      const body = init.body;
      assert.equal(body.get("authenticity_token"), "csrf-123");
      assert.equal(body.get("g-recaptcha-response"), "captcha-token-xyz");
      assert.equal(body.get("name"), "Team Retro");
      assert.equal(body.get("numberOfSections"), "2");
      assert.equal(body.get("sectionname0"), "Good");
      assert.equal(body.get("sectionname1"), "Bad");
      assert.equal((init.headers as Record<string, string>).cookie, "_session=abc");
      return new Response("", { status: 302, headers: { location: "/for/Team%20Retro/xyz789" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  try {
    const client = new IdeaboardzClient("https://example.ideaboardz.test", solver);
    const board = await client.createBoard({
      name: "Team Retro",
      description: "Sprint 5",
      sections: ["Good", "Bad"],
    });

    assert.deepEqual(board, {
      id: "xyz789",
      name: "Team Retro",
      url: "https://example.ideaboardz.test/for/Team Retro/xyz789",
    });
    assert.deepEqual(solverCall, {
      siteKey: "site-key-abc",
      pageUrl: "https://example.ideaboardz.test/",
    });
  } finally {
    mock.restore();
  }
});

test("createBoard throws without a captcha solver", async () => {
  const client = new IdeaboardzClient("https://example.ideaboardz.test");
  await assert.rejects(
    () => client.createBoard({ name: "x", description: "y", sections: ["a"] }),
    /captcha solver/,
  );
});

test("createBoard surfaces a non-redirect response as a likely captcha rejection", async () => {
  const formHtml = `
    <form action="/retros" method="post">
      <input name="authenticity_token" value="csrf-123" />
      <div class="g-recaptcha" data-sitekey="site-key-abc"></div>
    </form>
  `;
  const solver: CaptchaSolver = {
    async solveRecaptchaV2() {
      return "token";
    },
  };
  const mock = installFetchMock(async (input) => {
    const url = String(input);
    if (url.endsWith("/")) {
      return new Response(formHtml, { status: 200 });
    }
    return new Response("captcha failed", { status: 200 });
  });

  try {
    const client = new IdeaboardzClient("https://example.ideaboardz.test", solver);
    await assert.rejects(
      () => client.createBoard({ name: "x", description: "y", sections: ["a"] }),
      /did not redirect/,
    );
  } finally {
    mock.restore();
  }
});

test("request errors include status and endpoint", async () => {
  const mock = installFetchMock(async () => new Response("Not Found", { status: 404, statusText: "Not Found" }));

  try {
    const client = new IdeaboardzClient("https://example.ideaboardz.test");
    await assert.rejects(
      () => client.listPoints({ name: "retro", id: "123" }),
      /Ideaboardz request failed \(404 Not Found\) for \/retros\/retro\/123\/points.json: Not Found/,
    );
  } finally {
    mock.restore();
  }
});
