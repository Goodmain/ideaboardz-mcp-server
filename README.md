# ideaboardz-mcp-server

MCP server for integrating with public boards on [ideaboardz.com](https://ideaboardz.com/).

## Features

- Read board metadata and section IDs
- List stickies from a board
- Create, update, move, delete, and vote stickies

## Requirements

- Node.js 18+

## Local Setup

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

## MCP Config (OpenCode)

After publishing, use this OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ideaboardz": {
      "type": "local",
      "command": ["npx", "-y", "ideaboardz-mcp-server"]
    }
  }
}
```

If you published under a different package name, replace `ideaboardz-mcp-server` with your published name.

## MCP Config (Claude)

Use this in your Claude MCP config (for example, Claude Desktop):

```json
{
  "mcpServers": {
    "ideaboardz": {
      "command": "npx",
      "args": ["-y", "ideaboardz-mcp-server"]
    }
  }
}
```

If you published under a different package name, replace `ideaboardz-mcp-server` with your published name.

### Example Claude Prompts

- "Get the sections for board `test/2` so I can see each `sectionId`."
- "List all stickies in `test/2` and group them by section."
- "Create a sticky in section `12345` on `test/2` with message `Ship weekly demo`."
- "Move sticky `67890` to section `12346` on `test/2`."
- "Upvote sticky `67890` on `test/2`."
- "Delete sticky `67890` from `test/2`."

## MCP Config (Local Build)

Use this if you want to run from a local clone instead of npm:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ideaboardz": {
      "type": "local",
      "command": ["node", "/absolute/path/to/ideaboardz-mcp/dist/index.js"]
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
