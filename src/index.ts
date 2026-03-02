import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { IdeaboardzClient, type BoardRef, type Point } from "./ideaboardz-client.js";

const client = new IdeaboardzClient(process.env.IDEABOARDZ_BASE_URL);

const server = new Server(
  {
    name: "ideaboardz-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

const boardInputSchema = z.object({
  board: z
    .string()
    .min(1)
    .describe("Board reference: full URL (https://ideaboardz.com/for/<name>/<id>) or '<name>/<id>'"),
});

const listPointsInputSchema = boardInputSchema;

const createStickyInputSchema = boardInputSchema.extend({
  sectionId: z.number().int().positive(),
  message: z.string().min(1).max(140),
});

const updateStickyInputSchema = boardInputSchema.extend({
  stickyId: z.number().int().positive(),
  sectionId: z.number().int().positive().optional(),
  message: z.string().min(1).max(140).optional(),
  oldMessage: z.string().optional(),
  targetSectionId: z.number().int().positive().optional(),
});

const deleteStickyInputSchema = boardInputSchema.extend({
  stickyId: z.number().int().positive(),
  sectionId: z.number().int().positive().optional(),
  message: z.string().optional(),
});

const voteStickyInputSchema = boardInputSchema.extend({
  stickyId: z.number().int().positive(),
  sectionId: z.number().int().positive().optional(),
});

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
  };
}

async function findPointSectionId(board: BoardRef, stickyId: number): Promise<number> {
  const points = await client.listPoints(board);
  const point = points.find((item) => item.id === stickyId);
  if (!point) {
    throw new Error(`Could not find sticky ${stickyId} on board ${board.name}/${board.id}`);
  }
  return point.section_id;
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_board",
        description: "Get board metadata and sections",
        inputSchema: {
          type: "object",
          properties: {
            board: {
              type: "string",
              description: "Board URL or '<name>/<id>'",
            },
          },
          required: ["board"],
        },
      },
      {
        name: "list_stickies",
        description: "List all stickies for a board",
        inputSchema: {
          type: "object",
          properties: {
            board: {
              type: "string",
              description: "Board URL or '<name>/<id>'",
            },
          },
          required: ["board"],
        },
      },
      {
        name: "create_sticky",
        description: "Create a sticky in a specific board section",
        inputSchema: {
          type: "object",
          properties: {
            board: {
              type: "string",
              description: "Board URL or '<name>/<id>'",
            },
            sectionId: {
              type: "number",
              description: "Target section ID",
            },
            message: {
              type: "string",
              description: "Sticky text (max 140 chars)",
            },
          },
          required: ["board", "sectionId", "message"],
        },
      },
      {
        name: "update_sticky",
        description: "Update sticky text and/or move it to another section",
        inputSchema: {
          type: "object",
          properties: {
            board: {
              type: "string",
              description: "Board URL or '<name>/<id>'",
            },
            stickyId: {
              type: "number",
              description: "Sticky ID",
            },
            sectionId: {
              type: "number",
              description: "Current section ID (optional; auto-resolved if omitted)",
            },
            message: {
              type: "string",
              description: "New sticky text",
            },
            oldMessage: {
              type: "string",
              description: "Current sticky text, if needed",
            },
            targetSectionId: {
              type: "number",
              description: "New section ID for moving sticky",
            },
          },
          required: ["board", "stickyId"],
        },
      },
      {
        name: "delete_sticky",
        description: "Delete a sticky",
        inputSchema: {
          type: "object",
          properties: {
            board: {
              type: "string",
              description: "Board URL or '<name>/<id>'",
            },
            stickyId: {
              type: "number",
              description: "Sticky ID",
            },
            sectionId: {
              type: "number",
              description: "Current section ID (optional; auto-resolved if omitted)",
            },
            message: {
              type: "string",
              description: "Sticky text, if needed by endpoint",
            },
          },
          required: ["board", "stickyId"],
        },
      },
      {
        name: "vote_sticky",
        description: "Upvote a sticky",
        inputSchema: {
          type: "object",
          properties: {
            board: {
              type: "string",
              description: "Board URL or '<name>/<id>'",
            },
            stickyId: {
              type: "number",
              description: "Sticky ID",
            },
            sectionId: {
              type: "number",
              description: "Current section ID (optional; auto-resolved if omitted)",
            },
          },
          required: ["board", "stickyId"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: input } = request.params;

  try {
    if (name === "get_board") {
      const args = boardInputSchema.parse(input);
      const boardRef = client.parseBoardRef(args.board);
      const board = await client.getBoard(boardRef);
      return jsonResult(board);
    }

    if (name === "list_stickies") {
      const args = listPointsInputSchema.parse(input);
      const boardRef = client.parseBoardRef(args.board);
      const points = await client.listPoints(boardRef);
      const grouped = points.reduce<Record<number, Point[]>>((acc, point) => {
        acc[point.section_id] ??= [];
        acc[point.section_id].push(point);
        return acc;
      }, {});

      return jsonResult({
        board: boardRef,
        count: points.length,
        points,
        bySection: grouped,
      });
    }

    if (name === "create_sticky") {
      const args = createStickyInputSchema.parse(input);
      const boardRef = client.parseBoardRef(args.board);
      const result = await client.createPoint(boardRef, args.sectionId, args.message);
      return jsonResult({ ok: true, result });
    }

    if (name === "update_sticky") {
      const args = updateStickyInputSchema.parse(input);
      const boardRef = client.parseBoardRef(args.board);

      if (args.message === undefined && args.targetSectionId === undefined && args.oldMessage === undefined) {
        throw new Error("At least one of message, targetSectionId, or oldMessage must be provided");
      }

      const sectionId = args.sectionId ?? (await findPointSectionId(boardRef, args.stickyId));
      const result = await client.updatePoint(boardRef, args.stickyId, sectionId, {
        message: args.message,
        oldMessage: args.oldMessage,
        targetSectionId: args.targetSectionId,
      });
      return jsonResult({ ok: true, result });
    }

    if (name === "delete_sticky") {
      const args = deleteStickyInputSchema.parse(input);
      const boardRef = client.parseBoardRef(args.board);
      const sectionId = args.sectionId ?? (await findPointSectionId(boardRef, args.stickyId));
      const result = await client.deletePoint(boardRef, args.stickyId, sectionId, args.message);
      return jsonResult({ ok: true, result });
    }

    if (name === "vote_sticky") {
      const args = voteStickyInputSchema.parse(input);
      const boardRef = client.parseBoardRef(args.board);
      const sectionId = args.sectionId ?? (await findPointSectionId(boardRef, args.stickyId));
      const result = await client.votePoint(boardRef, args.stickyId, sectionId);
      return jsonResult({ ok: true, result });
    }

    return errorResult(`Unknown tool: ${name}`);
  } catch (error) {
    return errorResult(error);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`Failed to start server: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
