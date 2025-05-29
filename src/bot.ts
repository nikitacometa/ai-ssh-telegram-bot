import TelegramBot from 'node-telegram-bot-api';
import { config, loadMCPServers, saveMCPServers } from './config';
import { SimpleSSHClient } from './ssh-client';
import { CommandParser } from './command-parser';
import { UIHelpers } from './ui-helpers';
import { UserSession, MCPServerConfig, CommandConfirmation, SSHConfig, ServerSetupState, ActiveCommand } from './types';

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
      { command: 'addserver', description: 'Add a new SSH server' },
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
    
    // Handle server setup flow
    if (session.serverSetup) {
      await this.handleServerSetupStep(chatId, userId, text);
      return;
    }
    
    // Handle quick command buttons
    const quickCommands: { [key: string]: string } = {
      '📁 Show Files': 'ls -la',
      '💾 Check Space': 'df -h',
      '🖥️ System Stats': 'uname -a && uptime',
      '🏃‍♂️ What\'s Running?': 'ps aux | head -20',
      '🌍 Network Check': 'netstat -tuln | head -20',
      '🧠 Memory Info': 'free -h',
      '⚙️ Settings': '/settings',
      '🆘 Need Help?': '/help',
      '👋 Bye Server': '/disconnect'
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
    
    const parsed = await this.commandParser.parse(text);

    if (parsed.type === 'system') {
      await this.handleSystemCommand(chatId, userId, parsed.command!);
    } else if (parsed.type === 'bash') {
      if (parsed.suggestions && parsed.suggestions.length > 1) {
        await this.showCommandSuggestions(chatId, userId, parsed.intent!, parsed.suggestions, parsed.explanation, parsed.category);
      } else {
        await this.handleBashCommand(chatId, userId, parsed.command || parsed.intent!);
      }
    } else {
      const confusedResponses = [
        "🤔 Hmm, that's a new one! I'm scratching my digital head...",
        "🤷 I'm confused like a chameleon in a bag of Skittles!",
        "😅 My circuits are confused! Help me out here...",
        "🤖 404: Understanding not found. Let's try again!",
        "🎪 That went over my head like a circus trapeze!"
      ];
      
      const randomConfused = confusedResponses[Math.floor(Math.random() * confusedResponses.length)];
      
      await this.uiHelpers.sendWithTyping(
        this.bot,
        chatId,
        `${randomConfused}\n\n` +
        "**Here's what I can do:**\n" +
        "• 🎯 Try the magic buttons below\n" +
        "• 💬 Say things like _'show me the files'_\n" +
        "• 🤓 Go full geek with `ls -la`\n\n" +
        "_Need a tutorial? Just type_ /help 🆘",
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
      case '/addserver':
        await this.handleAddServer(chatId, userId);
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
          "🔌 **Whoops! No Server Connected** 🙈\n\n" +
          "I'm like a phone without signal! Let's fix that:\n\n" +
          "🎯 **Quick Options:**\n" +
          "• 👀 Browse your server collection\n" +
          "• ⚡ Lightning-connect to default\n" +
          "• ✨ Add a shiny new server\n\n" +
          "_Pick your adventure below!_ 👇",
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '📡 Show Servers', callback_data: 'view_servers' },
                  { text: '⚡ Quick Connect', callback_data: 'quick_connect' }
                ],
                [{ text: '✨ Add New Server', callback_data: 'add_server' }]
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

    const confirmationMessages = [
      `🎯 **Ready to fire this command?**`,
      `🚀 **Launch sequence initiated!**`,
      `🎮 **Command locked and loaded!**`,
      `⚡ **Power up the flux capacitor?**`,
      `🎪 **Ready for the command circus?**`,
      `🔮 **The crystal ball shows...**`,
      `🎬 **Lights, camera, action?**`
    ];
    
    const randomMessage = confirmationMessages[Math.floor(Math.random() * confirmationMessages.length)];
    
    await this.bot.sendMessage(
      chatId,
      `${randomMessage}\n\n` +
      `📍 **Target:** _${serverName}_\n` +
      `💻 **Command:** \`${command}\`\n` +
      `⏰ **Time:** ${new Date().toLocaleTimeString()}\n\n` +
      `_${this.getRandomCommandQuote()}_`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🚀 Let\'s Go!', callback_data: 'confirm_cmd' },
              { text: '🛑 Abort!', callback_data: 'cancel_cmd' }
            ],
            [
              { text: '✏️ Edit First', callback_data: 'modify_cmd' },
              { text: '📚 History', callback_data: 'show_history' }
            ]
          ]
        }
      }
    );
  }

  private getRandomCommandQuote(): string {
    const quotes = [
      '"With great power comes great responsibility" - Spider-Man',
      '"Do or do not, there is no try" - Yoda',
      '"I\'ll be back" - Terminator (after this command)',
      '"May the force be with your command" - Server Jedi',
      '"Houston, we have a command" - Apollo 13',
      '"Show me the data!" - Jerry Maguire (probably)',
      '"Execute Order 66" - Wait, not that one!',
      '"Sudo make me a sandwich" - XKCD',
      '"Hello World!" - Every developer ever',
      '"It\'s not a bug, it\'s a feature" - Anonymous',
      '"Have you tried turning it off and on again?" - IT Crowd'
    ];
    
    return quotes[Math.floor(Math.random() * quotes.length)];
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
        
      case data.startsWith('suggest_'):
        const encodedCommand = data.replace('suggest_', '');
        try {
          const command = Buffer.from(encodedCommand, 'base64').toString();
          await this.handleBashCommand(chatId, userId, command);
        } catch (e) {
          await this.bot.sendMessage(chatId, '❌ Could not execute suggested command');
        }
        break;
        
      case data === 'custom_command':
        await this.bot.sendMessage(
          chatId,
          `✏️ **Custom Command**\n\nPlease type the command you want to run:`,
          { parse_mode: 'Markdown' }
        );
        break;
        
      case data === 'stop_command':
        await this.handleStopCommand(chatId, userId);
        break;
        
      case data.startsWith('setup_'):
        const setupAction = data.replace('setup_', '');
        await this.handleServerSetupAction(chatId, userId, setupAction);
        break;
    }
  }

  private async executeConfirmedCommand(chatId: number, userId: number) {
    const session = this.getOrCreateSession(userId);
    const confirmation = session.pendingConfirmation;
    
    if (!confirmation) return;

    // Check if this is a streaming command
    const isStreamingCommand = this.isStreamingCommand(confirmation.command);
    
    if (isStreamingCommand) {
      await this.executeStreamingCommand(chatId, userId, confirmation);
    } else {
      await this.executeRegularCommand(chatId, userId, confirmation);
    }
    
    session.pendingConfirmation = undefined;
  }

  private isStreamingCommand(command: string): boolean {
    const streamingPatterns = [
      /\btail\s+.*-f/i,
      /\blogs\s+.*-f/i,
      /\btop\b/i,
      /\bhtop\b/i,
      /\bwatch\b/i,
      /\bping\b/i,
      /\btcpdump\b/i,
      /\bnetstat\s+.*-c/i,
      /\bmount\s+.*-t\s+proc/i,
      /\bstrace\b/i,
      /\bnohup\b.*&\s*$/i
    ];
    
    return streamingPatterns.some(pattern => pattern.test(command));
  }

  private async executeStreamingCommand(chatId: number, userId: number, confirmation: CommandConfirmation) {
    const session = this.getOrCreateSession(userId);
    
    // Send initial message
    const statusMsg = await this.bot.sendMessage(
      chatId,
      `🔄 **Streaming Command Started**\n\n` +
      `📍 Server: ${this.mcpServers.find(s => s.id === confirmation.serverId)?.name}\n` +
      `💻 Command: \`${confirmation.command}\`\n` +
      `⏰ Started: ${new Date().toLocaleTimeString()}\n\n` +
      `📜 **Live Output:**\n\`\`\`\nInitializing...\n\`\`\``,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⏹️ Stop Command', callback_data: 'stop_command' }]
          ]
        }
      }
    );

    let output = '';
    let lastUpdateTime = Date.now();
    const startTime = Date.now();
    let updateCount = 0;
    const maxUpdates = 100; // Prevent too many updates

    try {
      const stream = await this.sshClient.executeStreamingCommand(
        confirmation.serverId,
        confirmation.command,
        (data: string) => {
          output += data;
          const now = Date.now();
          
          // Throttle updates to prevent spam
          if (now - lastUpdateTime > 2000 && updateCount < maxUpdates) {
            lastUpdateTime = now;
            updateCount++;
            
            // Keep only last 2000 characters for display
            const displayOutput = output.length > 2000 
              ? '...\n' + output.slice(-1900)
              : output;
            
            const runtime = ((now - startTime) / 1000).toFixed(1);
            
            this.bot.editMessageText(
              `🔄 **Streaming Command Running**\n\n` +
              `📍 Server: ${this.mcpServers.find(s => s.id === confirmation.serverId)?.name}\n` +
              `💻 Command: \`${confirmation.command}\`\n` +
              `⏰ Runtime: ${runtime}s\n` +
              `📊 Updates: ${updateCount}\n\n` +
              `📜 **Live Output:**\n\`\`\`\n${displayOutput.slice(-1800) || 'No output yet...'}\n\`\`\``,
              {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '⏹️ Stop Command', callback_data: 'stop_command' }]
                  ]
                }
              }
            ).catch(() => {}); // Ignore edit errors
          }
        },
        (error: string) => {
          output += `\nERROR: ${error}`;
        },
        (code: number) => {
          const runtime = ((Date.now() - startTime) / 1000).toFixed(1);
          
          // Final update
          this.bot.editMessageText(
            `✅ **Streaming Command Completed**\n\n` +
            `📍 Server: ${this.mcpServers.find(s => s.id === confirmation.serverId)?.name}\n` +
            `💻 Command: \`${confirmation.command}\`\n` +
            `⏰ Total runtime: ${runtime}s\n` +
            `🔢 Exit code: ${code}\n\n` +
            `📜 **Final Output:**\n\`\`\`\n${output.slice(-1800) || 'No output'}\n\`\`\``,
            {
              chat_id: chatId,
              message_id: statusMsg.message_id,
              parse_mode: 'Markdown'
            }
          ).catch(() => {});
          
          // Remove from active commands
          session.activeCommands?.delete(statusMsg.message_id.toString());
        }
      );

      // Store the active command for stop functionality
      session.activeCommands?.set(statusMsg.message_id.toString(), {
        messageId: statusMsg.message_id,
        process: stream,
        startTime,
        command: confirmation.command,
        serverId: confirmation.serverId
      });

    } catch (error) {
      const errorMessage = this.uiHelpers.getErrorMessage(error);
      
      await this.bot.editMessageText(
        `❌ **Streaming Command Failed**\n\n${errorMessage}`,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: 'Markdown'
        }
      );
    }
  }

  private async executeRegularCommand(chatId: number, userId: number, confirmation: CommandConfirmation) {
    const session = this.getOrCreateSession(userId);
    
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
      
      const successMessages = [
        '✅ **Boom! Command executed!**',
        '🎯 **Bullseye! Direct hit!**',
        '🚀 **Mission accomplished!**',
        '⚡ **Zap! Done in a flash!**',
        '🎪 **Ta-da! Command complete!**',
        '🏆 **Victory! Command conquered!**',
        '🎉 **Success! High five!**'
      ];
      
      const randomSuccess = successMessages[Math.floor(Math.random() * successMessages.length)];
      
      // Add execution time emoji
      let timeEmoji = '🐆'; // cheetah for fast
      if (executionTime > 5000) timeEmoji = '🐢'; // turtle for slow
      else if (executionTime > 1000) timeEmoji = '🐇'; // rabbit for medium
      
      await this.bot.sendMessage(
        chatId,
        `${randomSuccess}\n\n` +
        `📍 **Server:** ${this.mcpServers.find(s => s.id === confirmation.serverId)?.name}\n` +
        `⏱️ **Speed:** ${(executionTime / 1000).toFixed(2)}s ${timeEmoji}\n\n` +
        `**Output:**\n${formattedOutput}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Again!', callback_data: `history_${Buffer.from(confirmation.command).toString('base64').substring(0, 60)}` },
                { text: '📚 History', callback_data: 'show_history' }
              ],
              [{ text: '🏠 Home', callback_data: 'show_quick_commands' }]
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
      `🆘 **Need Help? I Got You!** 🦸‍♂️\n\n` +
      `🎮 **Power Commands:**\n` +
      `\`/start\` - Wake me up! 🌅\n` +
      `\`/help\` - You're here! 📍\n` +
      `\`/servers\` - Show server collection 📡\n` +
      `\`/connect\` - Link to a server 🔗\n` +
      `\`/disconnect\` - Break up with server 💔\n` +
      `\`/status\` - What's happening? 🔍\n` +
      `\`/cancel\` - Abort mission! 🚫\n\n` +
      `💬 **Talk to Me Like a Human:**\n` +
      `• _"Show me what files are there"_\n` +
      `• _"How much disk space left?"_\n` +
      `• _"What's running on port 3000?"_\n\n` +
      `🤓 **Or Go Full Nerd Mode:**\n` +
      `• Direct commands: \`ls -la\`\n` +
      `• In quotes: \`"ps aux | grep node"\`\n\n` +
      `🛡️ **Safety First:** Every command needs your thumbs up! 👍`,
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
        },
        serverSetup: undefined,
        activeCommands: new Map()
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

  private async showCommandSuggestions(chatId: number, userId: number, intent: string, suggestions: string[], explanation?: string, category?: string) {
    const keyboard = suggestions.slice(0, 6).map(cmd => ([{
      text: `💻 ${cmd}`,
      callback_data: `suggest_${Buffer.from(cmd).toString('base64')}`
    }]));
    
    // Add manual input option
    keyboard.push([{
      text: '✏️ Type custom command',
      callback_data: 'custom_command'
    }]);

    let message = `🎯 **AI Command Suggestions**\n\n` +
                 `You said: "_${intent}_"\n\n`;
    
    if (explanation) {
      message += `💡 **Analysis**: ${explanation}\n\n`;
    }
    
    if (category) {
      message += `📂 **Category**: ${category}\n\n`;
    }
    
    message += `🚀 **Suggested commands**:`;

    await this.bot.sendMessage(
      chatId,
      message,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: keyboard
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

  private async handleAddServer(chatId: number, userId: number) {
    const session = this.getOrCreateSession(userId);
    
    session.serverSetup = {
      step: 'hostname',
      serverData: {}
    };
    
    await this.bot.sendMessage(
      chatId,
      `➕ **Add New SSH Server**\n\n` +
      `Let's set up a new SSH connection! I'll guide you through the process.\n\n` +
      `**Step 1/6:** Please enter the **hostname or IP address** of your server:\n\n` +
      `Examples:\n` +
      `• \`192.168.1.100\`\n` +
      `• \`my-server.example.com\`\n` +
      `• \`server.mydomain.org\``,
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '❌ Cancel Setup', callback_data: 'setup_cancel' }
          ]]
        }
      }
    );
  }

  private async handleServerSetupStep(chatId: number, userId: number, text: string) {
    const session = this.getOrCreateSession(userId);
    const setup = session.serverSetup!;
    
    switch (setup.step) {
      case 'hostname':
        if (!text.trim()) {
          await this.bot.sendMessage(chatId, '❌ Please enter a valid hostname or IP address.');
          return;
        }
        setup.serverData.host = text.trim();
        setup.step = 'port';
        
        await this.bot.sendMessage(
          chatId,
          `✅ Hostname set: \`${setup.serverData.host}\`\n\n` +
          `**Step 2/6:** Enter the SSH port (press Enter for default 22):`,
          { 
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '✅ Use Default (22)', callback_data: 'setup_default_port' }],
                [{ text: '❌ Cancel Setup', callback_data: 'setup_cancel' }]
              ]
            }
          }
        );
        break;
        
      case 'port':
        const port = parseInt(text.trim());
        if (isNaN(port) || port < 1 || port > 65535) {
          await this.bot.sendMessage(chatId, '❌ Please enter a valid port number (1-65535).');
          return;
        }
        setup.serverData.port = port;
        setup.step = 'username';
        
        await this.bot.sendMessage(
          chatId,
          `✅ Port set: \`${setup.serverData.port}\`\n\n` +
          `**Step 3/6:** Enter the username for SSH connection:`,
          { 
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '❌ Cancel Setup', callback_data: 'setup_cancel' }
              ]]
            }
          }
        );
        break;
        
      case 'username':
        if (!text.trim()) {
          await this.bot.sendMessage(chatId, '❌ Please enter a valid username.');
          return;
        }
        setup.serverData.username = text.trim();
        setup.step = 'auth_method';
        
        await this.bot.sendMessage(
          chatId,
          `✅ Username set: \`${setup.serverData.username}\`\n\n` +
          `**Step 4/6:** Choose authentication method:`,
          { 
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔑 Password', callback_data: 'setup_auth_password' }],
                [{ text: '🗝️ Private Key File', callback_data: 'setup_auth_key' }],
                [{ text: '❌ Cancel Setup', callback_data: 'setup_cancel' }]
              ]
            }
          }
        );
        break;
        
      case 'password':
        if (!text.trim()) {
          await this.bot.sendMessage(chatId, '❌ Please enter a valid password.');
          return;
        }
        setup.serverData.password = text.trim();
        setup.step = 'confirm';
        
        // Delete the password message for security
        try {
          await this.bot.deleteMessage(chatId, (await this.bot.getUpdates()).pop()?.message?.message_id || 0);
        } catch (e) {}
        
        await this.showServerConfirmation(chatId, userId);
        break;
        
      case 'private_key':
        if (!text.trim()) {
          await this.bot.sendMessage(chatId, '❌ Please enter a valid private key file path.');
          return;
        }
        setup.serverData.privateKeyPath = text.trim();
        setup.step = 'confirm';
        
        await this.showServerConfirmation(chatId, userId);
        break;
    }
  }

  private async handleServerSetupAction(chatId: number, userId: number, action: string) {
    const session = this.getOrCreateSession(userId);
    const setup = session.serverSetup;
    
    if (!setup) return;
    
    switch (action) {
      case 'cancel':
        session.serverSetup = undefined;
        await this.bot.sendMessage(
          chatId,
          '❌ Server setup cancelled.',
          this.uiHelpers.createQuickCommands()
        );
        break;
        
      case 'default_port':
        setup.serverData.port = 22;
        setup.step = 'username';
        
        await this.bot.sendMessage(
          chatId,
          `✅ Port set: \`22\` (default)\n\n` +
          `**Step 3/6:** Enter the username for SSH connection:`,
          { 
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '❌ Cancel Setup', callback_data: 'setup_cancel' }
              ]]
            }
          }
        );
        break;
        
      case 'auth_password':
        setup.step = 'password';
        await this.bot.sendMessage(
          chatId,
          `🔑 **Password Authentication**\n\n` +
          `**Step 5/6:** Enter the password for user \`${setup.serverData.username}\`:\n\n` +
          `⚠️ Your password will be deleted from the chat for security.`,
          { 
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '❌ Cancel Setup', callback_data: 'setup_cancel' }
              ]]
            }
          }
        );
        break;
        
      case 'auth_key':
        setup.step = 'private_key';
        await this.bot.sendMessage(
          chatId,
          `🗝️ **Private Key Authentication**\n\n` +
          `**Step 5/6:** Enter the full path to your private key file:\n\n` +
          `Examples:\n` +
          `• \`/home/user/.ssh/id_rsa\`\n` +
          `• \`/Users/user/.ssh/id_ed25519\`\n` +
          `• \`C:\\Users\\user\\.ssh\\id_rsa\``,
          { 
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '❌ Cancel Setup', callback_data: 'setup_cancel' }
              ]]
            }
          }
        );
        break;
        
      case 'confirm':
        await this.saveNewServer(chatId, userId);
        break;
    }
  }

  private async showServerConfirmation(chatId: number, userId: number) {
    const session = this.getOrCreateSession(userId);
    const setup = session.serverSetup!;
    const data = setup.serverData;
    
    // Generate server name
    data.name = `${data.username}@${data.host}`;
    
    const authMethod = data.password ? 'Password' : 'Private Key';
    const authValue = data.password ? '••••••••' : data.privateKeyPath;
    
    await this.bot.sendMessage(
      chatId,
      `**Step 6/6:** Review and confirm server configuration:\n\n` +
      `🏷️ **Name**: \`${data.name}\`\n` +
      `🌐 **Host**: \`${data.host}\`\n` +
      `🔌 **Port**: \`${data.port}\`\n` +
      `👤 **Username**: \`${data.username}\`\n` +
      `🔐 **Auth**: ${authMethod} (\`${authValue}\`)\n\n` +
      `Ready to save this server?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Save Server', callback_data: 'setup_confirm' },
              { text: '❌ Cancel', callback_data: 'setup_cancel' }
            ]
          ]
        }
      }
    );
  }

  private async saveNewServer(chatId: number, userId: number) {
    const session = this.getOrCreateSession(userId);
    const setup = session.serverSetup!;
    const data = setup.serverData;
    
    try {
      // Create new server config
      const newServer: MCPServerConfig = {
        id: `ssh-${Date.now()}`,
        name: data.name!,
        type: 'ssh',
        config: {
          host: data.host!,
          port: data.port!,
          username: data.username!,
          password: data.password,
          privateKeyPath: data.privateKeyPath
        } as SSHConfig,
        enabled: true
      };
      
      // Add to servers list
      this.mcpServers.push(newServer);
      saveMCPServers(this.mcpServers);
      
      // Clear setup state
      session.serverSetup = undefined;
      
      await this.bot.sendMessage(
        chatId,
        `✅ **Server Added Successfully!**\n\n` +
        `🎉 Server \`${data.name}\` has been added to your configuration.\n\n` +
        `You can now connect to it using:\n` +
        `• Quick connect button\n` +
        `• \`/connect ${data.name}\`\n` +
        `• \`/servers\` to see all servers`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔗 Connect Now', callback_data: `connect_${newServer.id}` },
                { text: '📡 View All Servers', callback_data: 'view_servers' }
              ]
            ]
          }
        }
      );
      
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ **Error saving server**: ${error}\n\nPlease try again with \`/addserver\`.`,
        { parse_mode: 'Markdown' }
      );
      session.serverSetup = undefined;
    }
  }

  private async handleStopCommand(chatId: number, userId: number) {
    const session = this.getOrCreateSession(userId);
    
    if (!session.activeCommands || session.activeCommands.size === 0) {
      await this.bot.sendMessage(chatId, '❌ No active commands to stop.');
      return;
    }
    
    // Stop all active commands
    for (const [commandId, activeCmd] of session.activeCommands) {
      if (activeCmd.process) {
        try {
          activeCmd.process.kill();
        } catch (e) {}
      }
      
      try {
        await this.bot.editMessageText(
          `⏹️ **Command Stopped**\n\n` +
          `Command: \`${activeCmd.command}\`\n` +
          `Runtime: ${((Date.now() - activeCmd.startTime) / 1000).toFixed(1)}s\n\n` +
          `Stopped by user request.`,
          {
            chat_id: chatId,
            message_id: activeCmd.messageId,
            parse_mode: 'Markdown'
          }
        );
      } catch (e) {}
    }
    
    session.activeCommands.clear();
    await this.bot.sendMessage(chatId, '✅ All commands stopped.');
  }
}