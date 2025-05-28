import TelegramBot from 'node-telegram-bot-api';
import { config, loadMCPServers, saveMCPServers } from './config';
import { SimpleSSHClient } from './ssh-client';
import { CommandParser } from './command-parser';
import { UserSession, MCPServerConfig, CommandConfirmation, SSHConfig } from './types';

export class TelegramMCPBot {
  private bot: TelegramBot;
  private sshClient: SimpleSSHClient;
  private commandParser: CommandParser;
  private userSessions: Map<number, UserSession> = new Map();
  private mcpServers: MCPServerConfig[] = [];

  constructor() {
    this.bot = new TelegramBot(config.telegramBotToken, { polling: true });
    this.sshClient = new SimpleSSHClient();
    this.commandParser = new CommandParser();
    this.mcpServers = loadMCPServers();
  }

  async start() {
    console.log('Starting Telegram MCP Bot...');
    
    // Initialize default server connection
    await this.initializeDefaultServer();
    
    // Set up bot commands
    await this.bot.setMyCommands([
      { command: 'start', description: 'Start the bot' },
      { command: 'help', description: 'Show help message' },
      { command: 'servers', description: 'List available MCP servers' },
      { command: 'connect', description: 'Connect to a server' },
      { command: 'disconnect', description: 'Disconnect from current server' },
      { command: 'status', description: 'Show connection status' },
      { command: 'cancel', description: 'Cancel pending operation' }
    ]);

    // Set up message handlers
    this.setupHandlers();
    
    console.log('Bot is running!');
  }

  private async initializeDefaultServer() {
    const defaultServer = this.mcpServers.find(s => s.id === 'default-ssh');
    if (defaultServer && defaultServer.enabled && defaultServer.config.host) {
      try {
        await this.sshClient.connect(defaultServer.id, defaultServer.config as SSHConfig);
        console.log('Connected to default SSH server');
      } catch (error) {
        console.error('Failed to connect to default server:', error);
      }
    }
  }

  private setupHandlers() {
    this.bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id || chatId;
      const text = msg.text || '';

      try {
        await this.handleMessage(chatId, userId, text);
      } catch (error) {
        console.error('Error handling message:', error);
        await this.bot.sendMessage(chatId, '❌ An error occurred. Please try again.');
      }
    });

    this.bot.on('callback_query', async (callbackQuery) => {
      const chatId = callbackQuery.message?.chat.id;
      const userId = callbackQuery.from.id;
      const data = callbackQuery.data;

      if (!chatId || !data) return;

      try {
        await this.handleCallbackQuery(chatId, userId, data, callbackQuery.id);
      } catch (error) {
        console.error('Error handling callback:', error);
        await this.bot.answerCallbackQuery(callbackQuery.id, {
          text: 'An error occurred',
          show_alert: true
        });
      }
    });
  }

  private async handleMessage(chatId: number, userId: number, text: string) {
    const session = this.getOrCreateSession(userId);
    const parsed = this.commandParser.parse(text);

    if (parsed.type === 'system') {
      await this.handleSystemCommand(chatId, userId, parsed.command!);
    } else if (parsed.type === 'bash') {
      await this.handleBashCommand(chatId, userId, parsed.command || parsed.intent!);
    } else {
      await this.bot.sendMessage(
        chatId,
        "I couldn't understand that command. Try:\n" +
        "• System commands like /help or /servers\n" +
        "• Bash commands like 'list files' or 'show disk space'\n" +
        "• Explicit commands in quotes: \"ls -la\""
      );
    }
  }

  private async handleSystemCommand(chatId: number, userId: number, command: string) {
    const parts = command.split(' ');
    const cmd = parts[0].toLowerCase();

    switch (cmd) {
      case '/start':
        await this.handleStart(chatId);
        break;
      case '/help':
        await this.handleHelp(chatId);
        break;
      case '/servers':
        await this.handleListServers(chatId);
        break;
      case '/connect':
        await this.handleConnect(chatId, userId, parts.slice(1).join(' '));
        break;
      case '/disconnect':
        await this.handleDisconnect(chatId, userId);
        break;
      case '/status':
        await this.handleStatus(chatId, userId);
        break;
      case '/cancel':
        await this.handleCancel(chatId, userId);
        break;
    }
  }

  private async handleBashCommand(chatId: number, userId: number, command: string) {
    const session = this.getOrCreateSession(userId);
    
    if (!session.activeServer) {
      const servers = this.sshClient.getConnectedServers();
      if (servers.length === 0) {
        await this.bot.sendMessage(
          chatId,
          "❌ No servers connected. Use /servers to see available servers."
        );
        return;
      }
      session.activeServer = servers[0];
    }

    // Create confirmation request
    const confirmation: CommandConfirmation = {
      userId,
      command,
      serverId: session.activeServer,
      timestamp: Date.now(),
      confirmed: false
    };
    
    session.pendingConfirmation = confirmation;

    const serverName = this.mcpServers.find(s => s.id === session.activeServer)?.name || session.activeServer;

    await this.bot.sendMessage(
      chatId,
      `🔐 **Security Confirmation**\n\n` +
      `Server: *${serverName}*\n` +
      `Command: \`${command}\`\n\n` +
      `Do you want to execute this command?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Confirm', callback_data: 'confirm_cmd' },
            { text: '❌ Cancel', callback_data: 'cancel_cmd' }
          ]]
        }
      }
    );
  }

  private async handleCallbackQuery(chatId: number, userId: number, data: string, callbackId: string) {
    const session = this.getOrCreateSession(userId);

    if (data === 'confirm_cmd' && session.pendingConfirmation) {
      await this.bot.answerCallbackQuery(callbackId, { text: 'Executing command...' });
      await this.executeConfirmedCommand(chatId, userId);
    } else if (data === 'cancel_cmd') {
      session.pendingConfirmation = undefined;
      await this.bot.answerCallbackQuery(callbackId, { text: 'Command cancelled' });
      await this.bot.sendMessage(chatId, '❌ Command execution cancelled.');
    } else if (data.startsWith('connect_')) {
      const serverId = data.replace('connect_', '');
      await this.connectToServer(chatId, userId, serverId);
      await this.bot.answerCallbackQuery(callbackId);
    }
  }

  private async executeConfirmedCommand(chatId: number, userId: number) {
    const session = this.getOrCreateSession(userId);
    const confirmation = session.pendingConfirmation;
    
    if (!confirmation) return;

    await this.bot.sendMessage(chatId, '⏳ Executing command...');

    try {
      const result = await this.sshClient.executeCommand(
        confirmation.serverId,
        confirmation.command
      );

      // Split long results into multiple messages
      const maxLength = 4000;
      if (result.length > maxLength) {
        const chunks = this.splitIntoChunks(result, maxLength);
        for (const chunk of chunks) {
          await this.bot.sendMessage(chatId, `\`\`\`\n${chunk}\n\`\`\``, {
            parse_mode: 'Markdown'
          });
        }
      } else {
        await this.bot.sendMessage(chatId, `\`\`\`\n${result}\n\`\`\``, {
          parse_mode: 'Markdown'
        });
      }
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Error executing command: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      session.pendingConfirmation = undefined;
    }
  }

  private async handleStart(chatId: number) {
    await this.bot.sendMessage(
      chatId,
      `🤖 *Welcome to SSH Telegram Bot!*\n\n` +
      `I can help you execute commands on remote servers through SSH.\n\n` +
      `*Features:*\n` +
      `• Execute bash commands with confirmation\n` +
      `• Manage multiple SSH server connections\n` +
      `• Natural language command understanding\n\n` +
      `Use /help to see available commands.`,
      { parse_mode: 'Markdown' }
    );
  }

  private async handleHelp(chatId: number) {
    await this.bot.sendMessage(
      chatId,
      `📚 *Available Commands:*\n\n` +
      `*System Commands:*\n` +
      `/start - Start the bot\n` +
      `/help - Show this help message\n` +
      `/servers - List available SSH servers\n` +
      `/connect [server] - Connect to a server\n` +
      `/disconnect - Disconnect from current server\n` +
      `/status - Show connection status\n` +
      `/cancel - Cancel pending operation\n\n` +
      `*Executing Commands:*\n` +
      `• Send bash commands directly: "ls -la"\n` +
      `• Use natural language: "show me the files"\n` +
      `• Commands in quotes: \`"df -h"\`\n\n` +
      `All commands require confirmation before execution for security.`,
      { parse_mode: 'Markdown' }
    );
  }

  private async handleListServers(chatId: number) {
    const connected = this.sshClient.getConnectedServers();
    
    let message = '*📡 SSH Servers:*\n\n';
    
    for (const server of this.mcpServers) {
      const isConnected = connected.includes(server.id);
      const status = isConnected ? '🟢 Connected' : '⚪ Disconnected';
      const enabled = server.enabled ? '' : ' (Disabled)';
      
      message += `*${server.name}*${enabled}\n`;
      message += `ID: \`${server.id}\`\n`;
      message += `Type: ${server.type}\n`;
      message += `Status: ${status}\n\n`;
    }

    const keyboard = this.mcpServers
      .filter(s => s.enabled && !connected.includes(s.id))
      .map(s => [{
        text: `Connect to ${s.name}`,
        callback_data: `connect_${s.id}`
      }]);

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined
    });
  }

  private async handleConnect(chatId: number, userId: number, serverIdOrName: string) {
    if (!serverIdOrName) {
      await this.handleListServers(chatId);
      return;
    }

    const server = this.mcpServers.find(
      s => s.id === serverIdOrName || s.name.toLowerCase() === serverIdOrName.toLowerCase()
    );

    if (!server) {
      await this.bot.sendMessage(chatId, `❌ Server not found: ${serverIdOrName}`);
      return;
    }

    await this.connectToServer(chatId, userId, server.id);
  }

  private async connectToServer(chatId: number, userId: number, serverId: string) {
    const server = this.mcpServers.find(s => s.id === serverId);
    if (!server) return;

    await this.bot.sendMessage(chatId, `🔄 Connecting to ${server.name}...`);

    try {
      await this.sshClient.connect(serverId, server.config as SSHConfig);
      const session = this.getOrCreateSession(userId);
      session.activeServer = serverId;
      
      await this.bot.sendMessage(chatId, `✅ Connected to ${server.name}`);
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleDisconnect(chatId: number, userId: number) {
    const session = this.getOrCreateSession(userId);
    
    if (!session.activeServer) {
      await this.bot.sendMessage(chatId, '❌ No active server connection');
      return;
    }

    const server = this.mcpServers.find(s => s.id === session.activeServer);
    const serverName = server?.name || session.activeServer;

    try {
      await this.sshClient.disconnect(session.activeServer);
      session.activeServer = undefined;
      await this.bot.sendMessage(chatId, `✅ Disconnected from ${serverName}`);
    } catch (error) {
      await this.bot.sendMessage(chatId, `❌ Error disconnecting: ${error}`);
    }
  }

  private async handleStatus(chatId: number, userId: number) {
    const session = this.getOrCreateSession(userId);
    const connected = this.sshClient.getConnectedServers();
    
    let message = '*🔍 Connection Status:*\n\n';
    
    if (connected.length === 0) {
      message += '❌ No active connections\n';
    } else {
      message += '*Connected Servers:*\n';
      for (const serverId of connected) {
        const server = this.mcpServers.find(s => s.id === serverId);
        const isActive = session.activeServer === serverId;
        message += `• ${server?.name || serverId} ${isActive ? '(Active)' : ''}\n`;
      }
    }

    if (session.pendingConfirmation) {
      message += `\n⏳ *Pending Command:*\n\`${session.pendingConfirmation.command}\``;
    }

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  private async handleCancel(chatId: number, userId: number) {
    const session = this.getOrCreateSession(userId);
    
    if (session.pendingConfirmation) {
      session.pendingConfirmation = undefined;
      await this.bot.sendMessage(chatId, '✅ Pending command cancelled');
    } else {
      await this.bot.sendMessage(chatId, '❌ No pending operations to cancel');
    }
  }

  private getOrCreateSession(userId: number): UserSession {
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, { userId });
    }
    return this.userSessions.get(userId)!;
  }

  private splitIntoChunks(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let currentChunk = '';
    
    const lines = text.split('\n');
    for (const line of lines) {
      if (currentChunk.length + line.length + 1 > maxLength) {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = line;
      } else {
        currentChunk += (currentChunk ? '\n' : '') + line;
      }
    }
    
    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  }
}