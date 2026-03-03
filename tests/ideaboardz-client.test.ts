import test from "node:test";
import assert from "node:assert/strict";

import { IdeaboardzClient, type Point } from "../src/ideaboardz-client.js";

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
