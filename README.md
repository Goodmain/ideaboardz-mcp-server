# Ideaboardz MCP Server (TypeScript)

MCP server for integrating with public boards on [ideaboardz.com](https://ideaboardz.com/).

## Features

- Read board metadata and section IDs
- List stickies from a board
- Create, update, move, delete, and vote stickies

## Requirements

- Node.js 18+

## Setup

```bash
npm install
npm run build
```

## Run

```bash
npm start
```

For local development:

```bash
npm run dev
```

## MCP Config Example

Use this in your MCP client config (adjust absolute path):

```json
{
  "mcpServers": {
    "ideaboardz": {
      "command": "node",
      "args": ["/absolute/path/to/ideaboardz-mcp/dist/index.js"]
    }
  }
}
```

## Board Input Format

All tools accept a `board` argument in one of these forms:

- `https://ideaboardz.com/for/test/2`
- `test/2`

## Tools

- `get_board`
  - Input: `board`
  - Output: board id/name and sections (`sectionId` values are needed for write operations)

- `list_stickies`
  - Input: `board`
  - Output: all stickies and grouped by section

- `create_sticky`
  - Input: `board`, `sectionId`, `message`

- `update_sticky`
  - Input: `board`, `stickyId`, optional `sectionId`, optional `message`, optional `oldMessage`, optional `targetSectionId`

- `delete_sticky`
  - Input: `board`, `stickyId`, optional `sectionId`, optional `message`

- `vote_sticky`
  - Input: `board`, `stickyId`, optional `sectionId`

## Notes

- This server targets publicly accessible board operations.
- Ideaboardz behavior can change over time; if endpoints change, update `src/ideaboardz-client.ts`.
