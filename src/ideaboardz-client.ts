import { load } from "cheerio";

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

export class IdeaboardzClient {
  private readonly baseUrl: string;

  constructor(baseUrl = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  parseBoardRef(input: string): BoardRef {
    return toBoardRef(input);
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
