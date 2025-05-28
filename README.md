# Telegram MCP Bot

A Telegram bot that integrates with MCP (Model Context Protocol) servers to execute commands remotely with user confirmation.

## Features

- 🤖 Natural language command understanding
- 🔐 Command confirmation before execution
- 🌐 Multiple MCP server management
- 🚀 SSH server integration via mcp-server-ssh
- 💬 Interactive Telegram interface

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```

4. Configure your environment variables:
   - `TELEGRAM_BOT_TOKEN`: Get from [@BotFather](https://t.me/botfather)
   - SSH configuration for default server

5. Build and run:
   ```bash
   npm run dev
   ```

## Usage

### Bot Commands

- `/start` - Start the bot
- `/help` - Show help message
- `/servers` - List available MCP servers
- `/connect [server]` - Connect to a specific server
- `/disconnect` - Disconnect from current server
- `/status` - Show connection status
- `/cancel` - Cancel pending operation

### Executing Commands

You can execute commands in several ways:

1. **Direct commands**: `"ls -la"`
2. **Natural language**: "show me the files"
3. **Explicit execution**: "run df -h"

All commands require confirmation before execution for security.

## Development

- `npm run build` - Build TypeScript files
- `npm run start` - Start the bot
- `npm run dev` - Build and start
- `npm run watch` - Watch mode for development

## Architecture

- `src/bot.ts` - Main bot logic and Telegram handlers
- `src/mcp-client.ts` - MCP client for server connections
- `src/command-parser.ts` - Natural language command parsing
- `src/config.ts` - Configuration management
- `src/types.ts` - TypeScript type definitions

## Security

- All commands require explicit user confirmation
- Session-based command execution
- Secure credential management via environment variables