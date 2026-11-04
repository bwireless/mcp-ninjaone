# mcp-ninjaone

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for **NinjaOne** (formerly NinjaRMM), providing AI assistants with full access to remote monitoring and management through the NinjaOne REST API v2.

## Features

**24 tools** across five categories. Read-only tools are annotated `readOnlyHint`; tools that change state (reset alerts, maintenance mode, running scripts) are annotated `destructiveHint` so MCP clients can ask for confirmation.

### Device Management
| Tool | Description |
|------|-------------|
| `list_devices` | List devices (filter by organization or NinjaOne device filter, paginated) |
| `get_device` | Detailed device info: OS, hardware, memory, IPs, last logged-in user, maintenance status |
| `get_device_activities` | Device activity log (alerts, scripts, patches, status changes) with time/type filters |
| `get_device_os_patch_status` | Pending OS patches **and** patch install history (installed/failed) |
| `get_device_software` | Installed software |
| `get_device_processor_info` | CPU/processor details |
| `get_device_disks` | Physical disks (model, size, health) |
| `get_device_volumes` | Volumes/partitions with capacity, free space, BitLocker status |

### Organizations & Policies
| Tool | Description |
|------|-------------|
| `list_organizations` | List organizations (clients/customers) |
| `get_organization` | Organization details including locations, policies, settings |
| `list_organization_devices` | Devices belonging to an organization |
| `get_organization_locations` | Locations configured for an organization |
| `get_organization_policies` | Role → policy assignments for an organization, with policy names |
| `list_policies` | All policies (alert conditions are configured inside policies) |

### Alerts
| Tool | Description |
|------|-------------|
| `list_alerts` | Active alerts across devices; filter by severity, organization, device filter, or source type |
| `list_device_alerts` | Active alerts for one device |
| `reset_alert` | Reset (clear) an alert by UID |

### Maintenance Mode
| Tool | Description |
|------|-------------|
| `list_maintenance_windows` | Devices currently in or scheduled for maintenance |
| `create_maintenance_window` | Put a device in maintenance (by end time or duration; choose ALERTS/PATCHING/AVSCANS/TASKS) |
| `cancel_device_maintenance` | End maintenance mode for a device |

### Jobs & Scripting
| Tool | Description |
|------|-------------|
| `list_running_jobs` | Jobs currently running across devices |
| `get_device_jobs` | Jobs currently running on one device |
| `get_device_scripting_options` | Scripts, built-in actions, and run-as roles available for a device |
| `run_script_on_device` | Run a saved script or built-in action on a device |

## Installation

```bash
git clone https://github.com/bwireless/mcp-ninjaone.git
cd mcp-ninjaone
npm install
npm run build
```

## Configuration

The server is configured via environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `NINJAONE_CLIENT_ID` | Yes | OAuth2 client ID from NinjaOne API credentials |
| `NINJAONE_CLIENT_SECRET` | Yes | OAuth2 client secret from NinjaOne API credentials |
| `NINJAONE_INSTANCE` | Yes | NinjaOne instance hostname (see table below). A full URL like `https://app.ninjarmm.com` also works |
| `NINJAONE_SCOPE` | No | OAuth scopes to request. Default: `monitoring management control` |
| `NINJAONE_TIMEOUT_MS` | No | Per-request timeout in ms. Default: `30000` |

### Instance Hostnames

| Region | Hostname |
|--------|----------|
| US | `app.ninjarmm.com` |
| EU | `eu.ninjarmm.com` |
| Oceania | `oc.ninjarmm.com` |
| Canada | `ca.ninjarmm.com` |
| US2 | `us2.ninjarmm.com` |

### Creating API Credentials

1. Log in to your NinjaOne instance
2. Navigate to **Administration > Apps > API**
3. Click **Add** to create a new API application
4. Set **Application Platform** to **API Services (machine-to-machine)**
5. Select **Client Credentials** as the allowed grant type
6. Grant the scopes: **Monitoring** (read data), **Management** (maintenance mode, resetting alerts), and **Control** (running scripts)
7. Copy the **Client ID** and **Client Secret**

If you only want read-only access, grant just **Monitoring** and set `NINJAONE_SCOPE=monitoring`. Write tools will then return a permission error.

## Usage with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ninjaone": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-ninjaone/dist/index.js"],
      "env": {
        "NINJAONE_CLIENT_ID": "your-client-id",
        "NINJAONE_CLIENT_SECRET": "your-client-secret",
        "NINJAONE_INSTANCE": "app.ninjarmm.com"
      }
    }
  }
}
```

## Usage with Claude Code

Add to your Claude Code MCP settings:

```bash
claude mcp add ninjaone \
  -e NINJAONE_CLIENT_ID=your-client-id \
  -e NINJAONE_CLIENT_SECRET=your-client-secret \
  -e NINJAONE_INSTANCE=app.ninjarmm.com \
  -- node /absolute/path/to/mcp-ninjaone/dist/index.js
```

## Example Prompts

Once connected, you can ask your AI assistant things like:

- *"Show me all devices that are currently offline"*
- *"What active alerts do we have across all organizations?"*
- *"Put device 1234 into maintenance mode for the next 2 hours"*
- *"List all devices for the Acme Corp organization"*
- *"What software is installed on device 5678?"*
- *"Show me recent activity for device 1234"*
- *"Run the cleanup script on device 9012"*
- *"What jobs are currently running across all devices?"*
- *"Clear all minor alerts for device 1234"*
- *"Which devices are in maintenance mode right now?"*
- *"What patches are pending on device 5678?"*

## Development

```bash
npm run dev        # Run from source with tsx
npm run build      # Compile TypeScript to dist/
npm start          # Run compiled output
npm test           # Run the test suite (mocked NinjaOne API, no credentials needed)
npm run typecheck  # Type-check without emitting
```

To poke at the tools interactively, use the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector -e NINJAONE_CLIENT_ID=... -e NINJAONE_CLIENT_SECRET=... -e NINJAONE_INSTANCE=app.ninjarmm.com node dist/index.js
```

## Architecture

```
src/
├── index.ts                # Entry point — reads env config, starts STDIO transport
├── server.ts               # Builds the McpServer and registers all tools
├── ninjaone-client.ts      # HTTP client with OAuth2 client-credentials flow
└── tools/
    ├── util.ts             # Shared result/error helpers
    ├── devices.ts          # Device management and inventory (8 tools)
    ├── organizations.ts    # Organizations and policies (6 tools)
    ├── alerts.ts           # Alert monitoring and reset (3 tools)
    ├── maintenance.ts      # Maintenance mode (3 tools)
    └── jobs.ts             # Jobs and scripting (4 tools)
test/
└── server.test.ts          # End-to-end tests over an in-memory MCP transport
```

The client handles the OAuth2 token lifecycle automatically: tokens are fetched on first use, cached, refreshed shortly before they expire, and refreshed once more if the API returns 401.

## Requirements

- Node.js 20+
- NinjaOne account with API access enabled

## License

SEE LICENSE IN LICENSE
