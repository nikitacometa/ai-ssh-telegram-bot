# Telegram SSH Bot

A Telegram bot that allows secure SSH command execution on remote servers with user confirmation.

## Features

- 🤖 Natural language command understanding
- 🔐 Command confirmation before execution
- 🌐 Multiple SSH server management
- 🚀 Direct SSH integration using ssh2 library
- 💬 Interactive Telegram interface
- ⚡ Typing indicators and loading animations
- 📊 Progress bars for connection status
- 🎮 Quick command buttons
- 📜 Command history with replay
- ⚙️ User preferences and settings
- 🎯 Smart error messages with suggestions
- 🎨 Beautiful formatted outputs

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
- `/servers` - List available SSH servers
- `/connect [server]` - Connect to a specific server
- `/disconnect` - Disconnect from current server
- `/status` - Show connection status
- `/cancel` - Cancel pending operation

### Executing Commands

You can execute commands in several ways:

1. **Quick Command Buttons**: Use the emoji keyboard for common tasks
2. **Direct commands**: Type commands like `ls -la`
3. **Natural language**: "show me the files" or "check disk space"
4. **Command history**: Replay previous commands with one click

All commands require confirmation before execution for security.

### User Experience

- **Typing indicators** show when the bot is processing
- **Progress bars** display connection status
- **Loading animations** during command execution
- **Smart suggestions** when commands fail
- **Interactive menus** for all operations
- **Persistent command history** per user

## Development

- `npm run build` - Build TypeScript files
- `npm run start` - Start the bot
- `npm run dev` - Build and start
- `npm run watch` - Watch mode for development

## Architecture

- `src/bot.ts` - Main bot logic and Telegram handlers
- `src/ssh-client.ts` - SSH client for server connections
- `src/command-parser.ts` - Natural language command parsing
- `src/config.ts` - Configuration management
- `src/types.ts` - TypeScript type definitions

## Security

- All commands require explicit user confirmation
- Session-based command execution
- Secure credential management via environment variables