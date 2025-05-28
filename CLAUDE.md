# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Telegram bot that integrates with MCP (Model Context Protocol) servers to execute commands remotely with user confirmation. The main feature is integration with mcp-server-ssh for executing bash commands on remote servers.

## Commands

### Build and Run
```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run the bot
npm run start

# Development mode (build + start)
npm run dev

# Watch mode for development
npm run watch
```

### Testing
Currently no tests are implemented. To add tests, consider using Jest:
```bash
npm install --save-dev jest @types/jest ts-jest
```

## Architecture

### Core Components

1. **Bot Layer** (`src/bot.ts`)
   - Handles Telegram interactions
   - Manages user sessions and command confirmations
   - Implements security through confirmation flow

2. **MCP Client** (`src/mcp-client.ts`)
   - Manages connections to MCP servers
   - Uses `@modelcontextprotocol/sdk` for communication
   - Specifically configured for mcp-server-ssh integration

3. **Command Parser** (`src/command-parser.ts`)
   - Natural language understanding for bash commands
   - Pattern matching for common command intents
   - Distinguishes between system commands and bash commands

4. **Configuration** (`src/config.ts`)
   - Environment variable management
   - MCP server configuration persistence
   - Default SSH server setup

### Key Design Patterns

1. **Session Management**: Each user has a session tracking their active server and pending confirmations
2. **Command Confirmation**: All bash commands require explicit user confirmation before execution
3. **Server Abstraction**: MCP servers are abstracted to allow future support for different server types
4. **Natural Language Processing**: Basic NLP for converting user intent to bash commands

### Security Considerations

- All commands require confirmation via inline keyboard
- Credentials are managed through environment variables
- Session-based command execution prevents cross-user interference
- Command results are properly escaped for Telegram markdown

## Development Guidelines

1. **Adding New MCP Server Types**: Extend the switch statement in `mcp-client.ts` connectToServer method
2. **Command Parser Enhancement**: Add new patterns to `bashKeywords` and `inferCommand` in `command-parser.ts`
3. **Bot Commands**: New Telegram commands should be added to both the handler and setMyCommands in `bot.ts`

## Environment Setup

Required environment variables:
- `TELEGRAM_BOT_TOKEN`: Bot token from @BotFather
- `SSH_HOST`: Default SSH server host
- `SSH_USERNAME`: SSH username
- `SSH_PASSWORD` or `SSH_PRIVATE_KEY_PATH`: Authentication method

## Common Issues

1. **MCP Connection Failures**: Check that npx can download and run `@dotvignesh/mcp-server-ssh`
2. **Command Not Found**: The command parser might need new patterns for specific command types
3. **Long Output**: Bot automatically splits messages over 4000 characters