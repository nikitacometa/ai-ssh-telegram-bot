# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Telegram bot that allows secure SSH command execution on remote servers with user confirmation. It uses the ssh2 library for direct SSH connections and includes natural language command understanding.

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

2. **SSH Client** (`src/ssh-client.ts`)
   - Manages direct SSH connections using ssh2 library
   - Handles command execution and output streaming
   - Supports both password and key-based authentication

3. **Command Parser** (`src/command-parser.ts`)
   - AI-powered natural language understanding using OpenAI (when API key provided)
   - Fallback to pattern matching for common command intents
   - Distinguishes between system commands and bash commands
   - Provides multiple command suggestions with explanations

4. **AI Command Analyzer** (`src/ai-command-analyzer.ts`)
   - OpenAI integration for advanced natural language processing
   - Analyzes user intent and suggests relevant bash commands
   - Provides confidence scores and categorization

5. **Configuration** (`src/config.ts`)
   - Environment variable management
   - MCP server configuration persistence
   - Default SSH server setup

### Key Design Patterns

1. **Session Management**: Each user has a session tracking their active server and pending confirmations
2. **Command Confirmation**: All bash commands require explicit user confirmation before execution
3. **Server Configuration**: SSH servers can be configured via JSON file or environment variables
4. **Natural Language Processing**: Basic NLP for converting user intent to bash commands

### Security Considerations

- All commands require confirmation via inline keyboard
- Credentials are managed through environment variables
- Session-based command execution prevents cross-user interference
- Command results are properly escaped for Telegram markdown

## Development Guidelines

1. **Adding New SSH Servers**: Add server configuration to the JSON file or create programmatically
2. **Command Parser Enhancement**: Add new patterns to `bashKeywords` and `inferCommand` in `command-parser.ts`
3. **Bot Commands**: New Telegram commands should be added to both the handler and setMyCommands in `bot.ts`

## Environment Setup

Required environment variables:
- `TELEGRAM_BOT_TOKEN`: Bot token from @BotFather
- `SSH_HOST`: Default SSH server host
- `SSH_USERNAME`: SSH username
- `SSH_PASSWORD` or `SSH_PRIVATE_KEY_PATH`: Authentication method

Optional environment variables:
- `OPENAI_API_KEY`: OpenAI API key for AI-powered command suggestions (enhances natural language understanding)

## Common Issues

1. **SSH Connection Failures**: Verify SSH credentials and ensure the server allows SSH connections
2. **Command Not Found**: The command parser might need new patterns for specific command types
3. **Long Output**: Bot automatically splits messages over 4000 characters
4. **Key Authentication**: Ensure private key file has correct permissions (600)