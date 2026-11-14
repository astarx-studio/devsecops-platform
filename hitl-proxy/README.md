# HITL Proxy

Local human-in-the-loop replacement for Cursor’s built-in AskQuestion (formerly the `mitm` web deploy).

## Architecture

```text
Cursor agent
  ├─ stdio MCP (primary) ──► mcp-bridge ──┐
  └─ HTTP POST /mcp (optional) ───────────┼──► Windows service (Express + store)
                                          │         127.0.0.1:3877
Electron tray UI (logon) ◄── /api/sessions┘
  └─ pending → always-on-top bottom-right answer window
```

- **Service** (`HitlProxy` in services.msc): owns MCP + session store. Stop the service to shut it down.
- **Tray UI**: starts at Windows logon **minimized to tray** (`--tray`; no dashboard flash). Close → tray (no Quit). Double-click tray → dashboard. Pending questions still open the bottom-right popup.
- **Not** a Docker/Traefik service anymore.

## Install (Windows)

From an elevated PowerShell:

```powershell
cd hitl-proxy
npm run install:windows
```

This builds the app, installs WinSW service `HITL Proxy`, writes `%ProgramData%\HITL Proxy\hitl.env`, registers a logon scheduled task for the Electron UI, and prints Cursor MCP config.

Uninstall:

```powershell
npm run uninstall:windows
```

## Cursor MCP config

**stdio (preferred):**

```json
{
  "mcpServers": {
    "hitl-proxy": {
      "command": "node",
      "args": [
        "C:/path/to/devsecops-platform/hitl-proxy/dist/stdio/mcp-bridge.js"
      ],
      "env": {
        "HITL_MCP_URL": "http://127.0.0.1:3877/mcp",
        "HITL_MCP_TOKEN": "<from %ProgramData%\\HITL Proxy\\hitl.env>"
      }
    }
  }
}
```

**HTTP (also supported):**

```json
{
  "mcpServers": {
    "hitl-proxy": {
      "url": "http://127.0.0.1:3877/mcp",
      "headers": {
        "Authorization": "Bearer <HITL_MCP_TOKEN>"
      }
    }
  }
}
```

## Agent flow

1. `ask_question` — one session (`questions[]` for multi-step). Optional “anything else?” step appended.
2. Tray popup appears bottom-right (always on top). Or open dashboard from tray.
3. `wait_for_answer` / `get_answer` with `sessionId`.
4. Sessions hard-deleted 1 hour after creation.

## Local dev (no service)

```bash
cd hitl-proxy
cp sample.env .env   # set HITL_MCP_TOKEN
npm install
# terminal A
export $(grep -v '^#' .env | xargs)   # or set vars in PowerShell
npm run dev:server
# terminal B
npm run dev:client
# terminal C (optional tray UI against the local server)
npm run build && npm run start:ui
```

## Env

| Variable          | Purpose                            |
| ----------------- | ---------------------------------- |
| `HITL_PORT`       | Default `3877`                     |
| `HITL_HOST`       | Default `127.0.0.1`                |
| `HITL_MCP_TOKEN`  | Bearer for `/mcp` and stdio bridge |
| `HITL_DATA_DIR`   | Session JSON directory             |
| `PUBLIC_BASE_URL` | URL returned in MCP tool payloads  |
