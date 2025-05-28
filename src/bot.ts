import TelegramBot from 'node-telegram-bot-api';
import { config, loadMCPServers, saveMCPServers } from './config';
import { SimpleSSHClient } from './ssh-client';
import { CommandParser } from './command-parser';
import { UIHelpers } from './ui-helpers';
import { UserSession, MCPServerConfig, CommandConfirmation, SSHConfig } from './types';

export class TelegramMCPBot {
  private bot: TelegramBot;
  private sshClient: SimpleSSHClient;
  private commandParser: CommandParser;
  private uiHelpers: UIHelpers;
  private userSessions: Map<number, UserSession> = new Map();
  private mcpServers: MCPServerConfig[] = [];

  constructor() {
    this.bot = new TelegramBot(config.telegramBotToken, { polling: true });
    this.sshClient = new SimpleSSHClient();
    this.commandParser = new CommandParser();
    this.uiHelpers = new UIHelpers();
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
    
    // Update last activity
    session.lastActivity = Date.now();
    
    // Handle quick command buttons
    const quickCommands: { [key: string]: string } = {
      '📁 List files': 'ls -la',
      '💾 Disk space': 'df -h',
      '📊 System info': 'uname -a && uptime',
      '🔄 Running processes': 'ps aux | head -20',
      '🌐 Network status': 'netstat -tuln | head -20',
      '📈 Memory usage': 'free -h',
      '⚙️ Settings': '/settings',
      '❓ Help': '/help',
      '🚪 Disconnect': '/disconnect'
    };
    
    // Check if it's a quick command
    const quickCommand = quickCommands[text];
    if (quickCommand) {
      if (quickCommand.startsWith('/')) {
        await this.handleSystemCommand(chatId, userId, quickCommand);
      } else {
        await this.handleBashCommand(chatId, userId, quickCommand);
      }
      return;
    }
    
    const parsed = this.commandParser.parse(text);

    if (parsed.type === 'system') {
      await this.handleSystemCommand(chatId, userId, parsed.command!);
    } else if (parsed.type === 'bash') {
      await this.handleBashCommand(chatId, userId, parsed.command || parsed.intent!);
    } else {
      await this.uiHelpers.sendWithTyping(
        this.bot,
        chatId,
        "🤔 I'm not sure what you mean. Would you like to:\n\n" +
        "• Try one of the quick commands below?\n" +
        "• Type a command like `ls` or `pwd`?\n" +
        "• Ask me something like 'show me the files'?\n\n" +
        "💡 Tip: You can also type /help for more guidance!",
        {
          parse_mode: 'Markdown',
          ...this.uiHelpers.createQuickCommands()
        }
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
      case '/settings':
        await this.handleSettings(chatId, userId);
        break;
    }
  }

  private async handleBashCommand(chatId: number, userId: number, command: string) {
    const session = this.getOrCreateSession(userId);
    
    if (!session.activeServer) {
      const servers = this.sshClient.getConnectedServers();
      if (servers.length === 0) {
        await this.uiHelpers.sendWithTyping(
          this.bot,
          chatId,
          "🔌 **No Server Connected**\n\n" +
          "I need to connect to a server first. Would you like to:\n\n" +
          "• View available servers? → /servers\n" +
          "• Connect to the default server?\n" +
          "• Add a new server?",
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '📡 View Servers', callback_data: 'view_servers' },
                  { text: '🔗 Quick Connect', callback_data: 'quick_connect' }
                ],
                [{ text: '➕ Add New Server', callback_data: 'add_server' }]
              ]
            }
          }
        );
        return;
      }
      session.activeServer = servers[0];
    }

    // Add to command history
    if (!session.commandHistory.includes(command)) {
      session.commandHistory.push(command);
      if (session.commandHistory.length > 20) {
        session.commandHistory.shift();
      }
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
      `🔐 **Command Confirmation**\n\n` +
      `📍 Server: *${serverName}*\n` +
      `💻 Command: \`${command}\`\n` +
      `⏰ Time: ${new Date().toLocaleTimeString()}\n\n` +
      `Ready to execute this command?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Execute', callback_data: 'confirm_cmd' },
              { text: '❌ Cancel', callback_data: 'cancel_cmd' }
            ],
            [
              { text: '📝 Modify Command', callback_data: 'modify_cmd' },
              { text: '📜 Show History', callback_data: 'show_history' }
            ]
          ]
        }
      }
    );
  }

  private async handleCallbackQuery(chatId: number, userId: number, data: string, callbackId: string) {
    const session = this.getOrCreateSession(userId);

    // Answer callback quickly to remove loading state
    await this.bot.answerCallbackQuery(callbackId, { text: '⏳ Processing...' });

    switch (true) {
      case data === 'confirm_cmd' && !!session.pendingConfirmation:
        await this.executeConfirmedCommand(chatId, userId);
        break;
        
      case data === 'cancel_cmd':
        session.pendingConfirmation = undefined;
        await this.bot.sendMessage(chatId, '❌ Command cancelled. What would you like to do next?', this.uiHelpers.createQuickCommands());
        break;
        
      case data === 'modify_cmd':
        if (session.pendingConfirmation) {
          await this.bot.sendMessage(
            chatId,
            `📝 Send me the modified command:\n\nCurrent: \`${session.pendingConfirmation.command}\``,
            { parse_mode: 'Markdown' }
          );
          session.pendingConfirmation = undefined;
        }
        break;
        
      case data === 'show_history':
        await this.handleShowHistory(chatId, userId);
        break;
        
      case data.startsWith('history_'):
        const encodedCmd = data.replace('history_', '');
        try {
          const command = Buffer.from(encodedCmd, 'base64').toString();
          await this.handleBashCommand(chatId, userId, command);
        } catch (e) {
          await this.bot.sendMessage(chatId, '❌ Could not restore command from history');
        }
        break;
        
      case data.startsWith('connect_'):
        const serverId = data.replace('connect_', '');
        await this.connectToServer(chatId, userId, serverId);
        break;
        
      case data === 'view_servers':
        await this.handleListServers(chatId);
        break;
        
      case data === 'quick_connect':
        const defaultServer = this.mcpServers.find(s => s.id === 'default-ssh');
        if (defaultServer) {
          await this.connectToServer(chatId, userId, defaultServer.id);
        }
        break;
        
      case data === 'add_server':
        await this.handleAddServerStart(chatId, userId);
        break;
        
      case data === 'refresh_servers':
        await this.handleListServers(chatId);
        break;
        
      case data.startsWith('status_'):
        const statusServerId = data.replace('status_', '');
        await this.handleServerStatus(chatId, statusServerId);
        break;
    }
  }

  private async executeConfirmedCommand(chatId: number, userId: number) {
    const session = this.getOrCreateSession(userId);
    const confirmation = session.pendingConfirmation;
    
    if (!confirmation) return;

    // Send initial loading message with animation
    const loadingMsg = await this.bot.sendMessage(
      chatId, 
      `${this.uiHelpers.getRandomLoadingMessage()}\n\n${this.uiHelpers.createLoadingAnimation(0)}`,
      { parse_mode: 'Markdown' }
    );

    // Update loading animation
    let animationStep = 0;
    const animationInterval = setInterval(async () => {
      animationStep++;
      try {
        await this.bot.editMessageText(
          `${this.uiHelpers.getRandomLoadingMessage()}\n\n${this.uiHelpers.createLoadingAnimation(animationStep)}`,
          {
            chat_id: chatId,
            message_id: loadingMsg.message_id,
            parse_mode: 'Markdown'
          }
        );
      } catch (e) {}
    }, 200);

    try {
      const startTime = Date.now();
      const result = await this.sshClient.executeCommand(
        confirmation.serverId,
        confirmation.command
      );
      const executionTime = Date.now() - startTime;

      // Clear loading animation
      clearInterval(animationInterval);
      await this.bot.deleteMessage(chatId, loadingMsg.message_id);

      // Format and send result
      const formattedOutput = this.uiHelpers.formatCommandOutput(result);
      
      await this.bot.sendMessage(
        chatId,
        `✅ **Command Executed Successfully**\n\n` +
        `📍 Server: ${this.mcpServers.find(s => s.id === confirmation.serverId)?.name}\n` +
        `⏱️ Execution time: ${(executionTime / 1000).toFixed(2)}s\n\n` +
        `**Output:**\n${formattedOutput}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Run Again', callback_data: `history_${Buffer.from(confirmation.command).toString('base64').substring(0, 60)}` },
                { text: '📜 History', callback_data: 'show_history' }
              ],
              [{ text: '🏠 Quick Commands', callback_data: 'show_quick_commands' }]
            ]
          }
        }
      );

      // Show quick commands if enabled
      if (session.preferences.quickCommands) {
        await this.bot.sendMessage(chatId, 'What would you like to do next?', this.uiHelpers.createQuickCommands());
      }
    } catch (error) {
      clearInterval(animationInterval);
      await this.bot.deleteMessage(chatId, loadingMsg.message_id);
      
      const errorMessage = this.uiHelpers.getErrorMessage(error);
      await this.bot.sendMessage(
        chatId,
        `❌ **Command Failed**\n\n${errorMessage}\n\n` +
        `💡 **Suggestions:**\n` +
        `• Check if the server is accessible\n` +
        `• Verify your credentials\n` +
        `• Try a simpler command like \`pwd\``,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Retry', callback_data: `history_${Buffer.from(confirmation.command).toString('base64').substring(0, 60)}` },
                { text: '🔌 Reconnect', callback_data: `connect_${confirmation.serverId}` }
              ],
              [{ text: '❓ Get Help', callback_data: 'help' }]
            ]
          }
        }
      );
    } finally {
      session.pendingConfirmation = undefined;
    }
  }

  private async handleStart(chatId: number) {
    const userName = await this.bot.getChat(chatId).then(chat => 
      'first_name' in chat ? chat.first_name : undefined
    ).catch(() => undefined);
    
    await this.bot.sendChatAction(chatId, 'typing');
    
    await this.uiHelpers.sendWithTyping(
      this.bot,
      chatId,
      this.uiHelpers.formatWelcomeMessage(userName),
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🚀 Quick Start', callback_data: 'quick_start' },
              { text: '📡 View Servers', callback_data: 'view_servers' }
            ],
            [
              { text: '❓ Tutorial', callback_data: 'tutorial' },
              { text: '⚙️ Settings', callback_data: 'settings' }
            ]
          ]
        }
      }
    );

    // Show quick commands
    setTimeout(() => {
      this.bot.sendMessage(
        chatId,
        '👆 Use these quick commands or type your own:',
        this.uiHelpers.createQuickCommands()
      );
    }, 1500);
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
    await this.bot.sendChatAction(chatId, 'typing');
    
    const connected = this.sshClient.getConnectedServers();
    
    if (this.mcpServers.length === 0) {
      await this.uiHelpers.sendWithTyping(
        this.bot,
        chatId,
        `📡 **No Servers Configured**\n\n` +
        `You haven't added any servers yet. Let's add your first server!\n\n` +
        `I'll guide you through the process step by step.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '➕ Add Your First Server', callback_data: 'add_server' }
            ]]
          }
        }
      );
      return;
    }
    
    const serverList = this.mcpServers.map(server => ({
      id: server.id,
      name: server.name,
      connected: connected.includes(server.id)
    }));
    
    let message = `📡 **Server Management**\n\n`;
    message += `You have ${this.mcpServers.length} server${this.mcpServers.length > 1 ? 's' : ''} configured:\n\n`;
    
    for (const server of this.mcpServers) {
      const isConnected = connected.includes(server.id);
      message += this.uiHelpers.formatServerInfo(server, isConnected) + '\n\n';
    }
    
    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: this.uiHelpers.createServerKeyboard(serverList)
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

    // Send connecting animation
    const connectingMsg = await this.bot.sendMessage(
      chatId,
      `🔄 **Connecting to ${server.name}...**\n\n` +
      `${this.uiHelpers.createProgressBar(0)}\n\n` +
      `Establishing secure connection...`,
      { parse_mode: 'Markdown' }
    );

    // Simulate progress
    let progress = 0;
    const progressInterval = setInterval(async () => {
      progress += 20;
      if (progress <= 80) {
        try {
          await this.bot.editMessageText(
            `🔄 **Connecting to ${server.name}...**\n\n` +
            `${this.uiHelpers.createProgressBar(progress)}\n\n` +
            `${progress <= 40 ? 'Establishing secure connection...' : 'Authenticating...'}`,
            {
              chat_id: chatId,
              message_id: connectingMsg.message_id,
              parse_mode: 'Markdown'
            }
          );
        } catch (e) {}
      }
    }, 300);

    try {
      await this.sshClient.connect(serverId, server.config as SSHConfig);
      const session = this.getOrCreateSession(userId);
      session.activeServer = serverId;
      
      clearInterval(progressInterval);
      
      // Show success
      await this.bot.editMessageText(
        `✅ **Successfully Connected!**\n\n` +
        `${this.uiHelpers.createProgressBar(100)}\n\n` +
        `You're now connected to *${server.name}*\n` +
        `Ready to execute commands! 🚀`,
        {
          chat_id: chatId,
          message_id: connectingMsg.message_id,
          parse_mode: 'Markdown'
        }
      );
      
      // Show quick commands after a moment
      setTimeout(() => {
        this.bot.sendMessage(
          chatId,
          `💡 Try these commands or type your own:`,
          this.uiHelpers.createQuickCommands()
        );
      }, 1000);
      
    } catch (error) {
      clearInterval(progressInterval);
      
      const errorMessage = this.uiHelpers.getErrorMessage(error);
      
      await this.bot.editMessageText(
        `❌ **Connection Failed**\n\n` +
        `${errorMessage}\n\n` +
        `Server: ${server.name}\n` +
        `Host: ${server.config.host}`,
        {
          chat_id: chatId,
          message_id: connectingMsg.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Retry', callback_data: `connect_${serverId}` },
                { text: '⚙️ Edit Server', callback_data: `edit_${serverId}` }
              ],
              [{ text: '📡 Other Servers', callback_data: 'view_servers' }]
            ]
          }
        }
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
      this.userSessions.set(userId, {
        userId,
        activeServer: undefined,
        pendingConfirmation: undefined,
        commandHistory: [],
        lastActivity: Date.now(),
        preferences: {
          quickCommands: true,
          verboseOutput: false
        }
      });
    }
    return this.userSessions.get(userId)!;
  }

  private async handleShowHistory(chatId: number, userId: number) {
    const session = this.getOrCreateSession(userId);
    
    if (session.commandHistory.length === 0) {
      await this.bot.sendMessage(
        chatId,
        `📜 **Command History**\n\nYou haven't run any commands yet. Try some of these:\n\n` +
        `• \`ls -la\` - List files\n` +
        `• \`pwd\` - Show current directory\n` +
        `• \`df -h\` - Check disk space`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    await this.bot.sendMessage(
      chatId,
      `📜 **Recent Commands**\n\nClick to run again:`,
      {
        parse_mode: 'Markdown',
        reply_markup: this.uiHelpers.createCommandHistoryKeyboard(session.commandHistory)
      }
    );
  }

  private async handleSettings(chatId: number, userId: number) {
    const session = this.getOrCreateSession(userId);
    
    await this.uiHelpers.sendWithTyping(
      this.bot,
      chatId,
      `⚙️ **Settings**\n\n` +
      `Customize your experience:\n\n` +
      `🎯 **Quick Commands**: ${session.preferences.quickCommands ? 'Enabled ✅' : 'Disabled ❌'}\n` +
      `📝 **Verbose Output**: ${session.preferences.verboseOutput ? 'Enabled ✅' : 'Disabled ❌'}\n\n` +
      `Active Server: ${session.activeServer ? this.mcpServers.find(s => s.id === session.activeServer)?.name : 'None'}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: `${session.preferences.quickCommands ? '🔕' : '🔔'} Toggle Quick Commands`,
                callback_data: 'toggle_quick_commands'
              }
            ],
            [
              {
                text: `${session.preferences.verboseOutput ? '🔇' : '🔊'} Toggle Verbose Output`,
                callback_data: 'toggle_verbose'
              }
            ],
            [
              { text: '📜 Clear History', callback_data: 'clear_history' },
              { text: '🔌 Reset Connection', callback_data: 'reset_connection' }
            ],
            [{ text: '⬅️ Back', callback_data: 'back_to_main' }]
          ]
        }
      }
    );
  }

  private async handleAddServerStart(chatId: number, userId: number) {
    await this.uiHelpers.sendWithTyping(
      this.bot,
      chatId,
      `➕ **Add New Server**\n\n` +
      `Let's set up a new SSH connection! I'll need some information:\n\n` +
      `1️⃣ Server hostname or IP\n` +
      `2️⃣ SSH port (usually 22)\n` +
      `3️⃣ Username\n` +
      `4️⃣ Authentication method\n\n` +
      `First, please send me the **hostname or IP address** of your server:`,
      { parse_mode: 'Markdown' }
    );
    
    // TODO: Implement conversation flow for adding server
  }

  private async handleServerStatus(chatId: number, serverId: string) {
    const server = this.mcpServers.find(s => s.id === serverId);
    if (!server) return;
    
    const isConnected = this.sshClient.isConnected(serverId);
    
    await this.bot.sendMessage(
      chatId,
      this.uiHelpers.formatServerInfo(server, isConnected),
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            isConnected ? 
              [{ text: '🔌 Disconnect', callback_data: `disconnect_${serverId}` }] :
              [{ text: '🔗 Connect', callback_data: `connect_${serverId}` }],
            [
              { text: '🗑️ Remove Server', callback_data: `remove_${serverId}` },
              { text: '⬅️ Back', callback_data: 'view_servers' }
            ]
          ]
        }
      }
    );
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