import { load } from "cheerio";

import type { CaptchaSolver } from "./captcha-solver.js";

export type BoardRef = {
  id: string;
  name: string;
};

export type BoardSection = {
  id: number;
  title: string;
};

export type BoardDetails = {
  id: string;
  name: string;
  sections: BoardSection[];
};

export type Point = {
  id: number;
  section_id: number;
  message: string;
  votes_count: number;
  updated_at?: string;
};

export type CreateBoardInput = {
  name: string;
  description: string;
  sections: string[];
};

const DEFAULT_BASE_URL = "https://ideaboardz.com";

function toBoardRef(value: string): BoardRef {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("Board reference is required");
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const url = new URL(trimmed);
    const [forSegment, boardName, boardId] = url.pathname.split("/").filter(Boolean);

    if (forSegment !== "for" || !boardName || !boardId) {
      throw new Error("Board URL must look like https://ideaboardz.com/for/<name>/<id>");
    }

    return { id: decodeURIComponent(boardId), name: decodeURIComponent(boardName) };
  }

  const [name, id] = trimmed.split("/");
  if (!name || !id) {
    throw new Error("Board reference must be '<name>/<id>' or a full Ideaboardz board URL");
  }

  return { id, name };
}

function parseCookies(headers: Headers): string {
  // getSetCookie is available on undici/Node 18.14+; fall back to the raw header.
  const raw =
    typeof (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [headers.get("set-cookie") ?? ""].filter(Boolean);

  return raw
    .map((entry) => entry.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

export class IdeaboardzClient {
  private readonly baseUrl: string;
  private readonly captchaSolver?: CaptchaSolver;

  constructor(baseUrl = DEFAULT_BASE_URL, captchaSolver?: CaptchaSolver) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.captchaSolver = captchaSolver;
  }

  parseBoardRef(input: string): BoardRef {
    return toBoardRef(input);
  }

  async createBoard(input: CreateBoardInput): Promise<BoardRef & { url: string }> {
    if (!this.captchaSolver) {
      throw new Error(
        "Board creation needs a captcha solver. Set TWOCAPTCHA_API_KEY so the server can solve the reCAPTCHA.",
      );
    }

    const name = input.name.trim();
    if (!name) {
      throw new Error("Board name is required");
    }
    if (name.includes(".")) {
      throw new Error("Board name must not contain a '.' character");
    }

    const description = input.description.trim();
    if (!description) {
      throw new Error("Board description is required");
    }

    const sections = input.sections.map((section) => section.trim()).filter(Boolean);
    if (sections.length < 1 || sections.length > 10) {
      throw new Error("A board needs between 1 and 10 sections");
    }

    // 1. Load the form to grab the CSRF token, reCAPTCHA site key, and session cookie.
    const formResponse = await fetch(`${this.baseUrl}/`, {
      headers: { "user-agent": "ideaboardz-mcp/0.1" },
    });
    if (!formResponse.ok) {
      throw new Error(`Failed to load board form (${formResponse.status} ${formResponse.statusText})`);
    }
    const cookie = parseCookies(formResponse.headers);
    const $ = load(await formResponse.text());

    const authenticityToken = $('form[action="/retros"] input[name="authenticity_token"]').attr("value");
    if (!authenticityToken) {
      throw new Error("Could not find the CSRF token on the board form");
    }

    const siteKey = $(".g-recaptcha").attr("data-sitekey") ?? $("[data-sitekey]").attr("data-sitekey");
    if (!siteKey) {
      throw new Error("Could not find the reCAPTCHA site key on the board form");
    }

    // 2. Solve the reCAPTCHA via the configured solver.
    const token = await this.captchaSolver.solveRecaptchaV2({
      siteKey,
      pageUrl: `${this.baseUrl}/`,
    });

    // 3. Submit the board creation form.
    const form = new URLSearchParams();
    form.set("utf8", "✓");
    form.set("authenticity_token", authenticityToken);
    form.set("name", name);
    form.set("description", description);
    form.set("numberOfSections", String(sections.length));
    sections.forEach((section, index) => {
      form.set(`sectionname${index}`, section);
    });
    form.set("g-recaptcha-response", token);
    form.set("commit", "Create Board");

    const headers: Record<string, string> = {
      "user-agent": "ideaboardz-mcp/0.1",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    };
    if (cookie) {
      headers.cookie = cookie;
    }

    const createResponse = await fetch(`${this.baseUrl}/retros`, {
      method: "POST",
      redirect: "manual",
      headers,
      body: form,
    });

    // Rails redirects to /for/<name>/<id> on success.
    const location = createResponse.headers.get("location");
    if (location) {
      const ref = toBoardRef(location.startsWith("http") ? location : `${this.baseUrl}${location}`);
      return { ...ref, url: `${this.baseUrl}/for/${ref.name}/${ref.id}` };
    }

    const body = await createResponse.text();
    throw new Error(
      `Board creation did not redirect (status ${createResponse.status}). The reCAPTCHA may have been rejected. Response: ${body.slice(0, 500)}`,
    );
  }

  async getBoard(board: BoardRef): Promise<BoardDetails> {
    const html = await this.requestText(`/for/${encodeURIComponent(board.name)}/${encodeURIComponent(board.id)}`);
    const $ = load(html);

    const sections: BoardSection[] = $(".section")
      .map((_, element) => {
        const rawId = $(element).attr("id") ?? "";
        const sectionId = Number(rawId.replace("section", ""));
        const title = $(element).find(".sectionTitle").first().text().trim();

        if (!Number.isFinite(sectionId) || !title) {
          return null;
        }

        return {
          id: sectionId,
          title,
        };
      })
      .get()
      .filter((value): value is BoardSection => value !== null);

    return {
      id: board.id,
      name: board.name,
      sections,
    };
  }

  async listPoints(board: BoardRef): Promise<Point[]> {
    return this.requestJson<Point[]>(`/retros/${encodeURIComponent(board.name)}/${encodeURIComponent(board.id)}/points.json`);
  }

  async createPoint(board: BoardRef, sectionId: number, message: string): Promise<unknown> {
    const form = new URLSearchParams();
    form.set("point[message]", message);

    return this.requestJson(
      `/api/retros/${encodeURIComponent(board.id)}/${encodeURIComponent(board.name)}/sections/${encodeURIComponent(String(sectionId))}/points`,
      {
        method: "POST",
        body: form,
      },
    );
  }

  async updatePoint(
    board: BoardRef,
    pointId: number,
    sectionId: number,
    updates: { message?: string; oldMessage?: string; targetSectionId?: number },
  ): Promise<unknown> {
    const form = new URLSearchParams();
    if (updates.message !== undefined) {
      form.set("point[message]", updates.message);
    }
    if (updates.oldMessage !== undefined) {
      form.set("point[oldmessage]", updates.oldMessage);
    }
    if (updates.targetSectionId !== undefined) {
      form.set("point[section_id]", String(updates.targetSectionId));
    }

    return this.requestJson(
      `/api/retros/${encodeURIComponent(board.id)}/${encodeURIComponent(board.name)}/sections/${encodeURIComponent(String(sectionId))}/points/${encodeURIComponent(String(pointId))}`,
      {
        method: "PUT",
        body: form,
      },
    );
  }

  async deletePoint(board: BoardRef, pointId: number, sectionId: number, message?: string): Promise<unknown> {
    const form = new URLSearchParams();
    if (message) {
      form.set("message", message);
    }

    return this.requestJson(
      `/api/retros/${encodeURIComponent(board.id)}/${encodeURIComponent(board.name)}/sections/${encodeURIComponent(String(sectionId))}/points/${encodeURIComponent(String(pointId))}`,
      {
        method: "DELETE",
        body: form,
      },
    );
  }

  async votePoint(board: BoardRef, pointId: number, sectionId: number): Promise<unknown> {
    return this.requestJson(
      `/api/retros/${encodeURIComponent(board.id)}/${encodeURIComponent(board.name)}/sections/${encodeURIComponent(String(sectionId))}/points/${encodeURIComponent(String(pointId))}/votes`,
      {
        method: "POST",
      },
    );
  }

  private async requestText(path: string, init: RequestInit = {}): Promise<string> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "user-agent": "ideaboardz-mcp/0.1",
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Ideaboardz request failed (${response.status} ${response.statusText}) for ${path}`);
    }

    return response.text();
  }

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const hasBody = init.body !== undefined;
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "user-agent": "ideaboardz-mcp/0.1",
        accept: "application/json, text/plain, */*",
        ...(hasBody ? { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" } : {}),
        ...(init.headers ?? {}),
      },
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Ideaboardz request failed (${response.status} ${response.statusText}) for ${path}: ${text}`);
    }

    if (!text) {
      return {} as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return { raw: text } as T;
    }
  }
}
