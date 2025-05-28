import TelegramBot from 'node-telegram-bot-api';

export class UIHelpers {
  private typingTimers: Map<number, NodeJS.Timeout> = new Map();

  async sendWithTyping(bot: TelegramBot, chatId: number, message: string, options?: any) {
    // Send typing indicator
    await bot.sendChatAction(chatId, 'typing');
    
    // Calculate typing time based on message length (50ms per character, max 3 seconds)
    const typingTime = Math.min(message.length * 50, 3000);
    
    // Keep typing indicator active
    const typingInterval = setInterval(() => {
      bot.sendChatAction(chatId, 'typing').catch(() => {});
    }, 2000);
    
    // Wait for "typing" effect
    await new Promise(resolve => setTimeout(resolve, typingTime));
    
    // Clear typing indicator
    clearInterval(typingInterval);
    
    // Send the message
    return bot.sendMessage(chatId, message, options);
  }

  formatCommandOutput(output: string): string {
    // Limit output length and add formatting
    const lines = output.split('\n');
    const maxLines = 50;
    
    if (lines.length > maxLines) {
      const truncated = lines.slice(0, maxLines).join('\n');
      return `\`\`\`\n${truncated}\n\`\`\`\n\n📄 _Output truncated (${lines.length - maxLines} more lines)_`;
    }
    
    return `\`\`\`\n${output}\n\`\`\``;
  }

  createProgressBar(progress: number, total: number = 100): string {
    const percentage = Math.round((progress / total) * 100);
    const filled = Math.round((progress / total) * 10);
    const empty = 10 - filled;
    
    return `${'▓'.repeat(filled)}${'░'.repeat(empty)} ${percentage}%`;
  }

  getRandomLoadingMessage(): string {
    const messages = [
      '🔄 Processing your request...',
      '⚡ Working on it...',
      '🚀 Executing command...',
      '💫 Almost there...',
      '🔮 Making magic happen...',
      '⏳ Just a moment...',
      '🎯 On it!',
      '🌟 Processing...'
    ];
    
    return messages[Math.floor(Math.random() * messages.length)];
  }

  getErrorMessage(error: any): string {
    const errorMessages: { [key: string]: string } = {
      'ECONNREFUSED': '🔌 Connection refused. Is the server running?',
      'ETIMEDOUT': '⏱️ Connection timed out. Server might be unreachable.',
      'ENOTFOUND': '🔍 Server not found. Check the hostname.',
      'Authentication failed': '🔐 Authentication failed. Check your credentials.',
      'EHOSTUNREACH': '🌐 Host unreachable. Check network connection.',
      'ECONNRESET': '🔄 Connection reset by server.',
    };

    const errorString = error.toString();
    
    for (const [key, message] of Object.entries(errorMessages)) {
      if (errorString.includes(key)) {
        return message;
      }
    }
    
    return `❌ Error: ${error.message || errorString}`;
  }

  createQuickCommands(): any {
    return {
      reply_markup: {
        keyboard: [
          ['📁 List files', '💾 Disk space', '📊 System info'],
          ['🔄 Running processes', '🌐 Network status', '📈 Memory usage'],
          ['⚙️ Settings', '❓ Help', '🚪 Disconnect']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      }
    };
  }

  createServerKeyboard(servers: Array<{id: string, name: string, connected: boolean}>): any {
    const keyboard = servers.map(server => [{
      text: `${server.connected ? '🟢' : '⚪'} ${server.name}`,
      callback_data: server.connected ? `status_${server.id}` : `connect_${server.id}`
    }]);
    
    keyboard.push([
      { text: '➕ Add New Server', callback_data: 'add_server' },
      { text: '🔄 Refresh', callback_data: 'refresh_servers' }
    ]);
    
    return { inline_keyboard: keyboard };
  }

  formatServerInfo(server: any, isConnected: boolean): string {
    return `
🖥️ **${server.name}**
${isConnected ? '🟢 Connected' : '⚪ Disconnected'}

📍 **Host:** \`${server.config.host}\`
👤 **User:** \`${server.config.username}\`
🔌 **Port:** \`${server.config.port || 22}\`
🔐 **Auth:** ${server.config.password ? 'Password' : 'SSH Key'}
    `.trim();
  }

  createCommandHistoryKeyboard(history: string[]): any {
    const keyboard = history.slice(-5).map(cmd => [{
      text: `📜 ${cmd.substring(0, 30)}${cmd.length > 30 ? '...' : ''}`,
      callback_data: `history_${Buffer.from(cmd).toString('base64').substring(0, 60)}`
    }]);
    
    return { inline_keyboard: keyboard };
  }

  formatWelcomeMessage(userName?: string): string {
    const greeting = userName ? `Hello ${userName}!` : 'Hello!';
    
    return `
🚀 **${greeting} Welcome to SSH Terminal Bot!**

I'm your friendly SSH assistant that helps you manage remote servers with style! 

✨ **What I can do:**
• 🔐 Securely connect to your servers
• 💬 Understand natural language commands
• 🎯 Execute commands with confirmation
• 📊 Show formatted outputs
• 💾 Remember your command history

🎮 **Quick Start:**
1. Type a command like "show files" or "check disk space"
2. Use the quick buttons below for common tasks
3. Say /help anytime for guidance

Ready to connect to a server? Let's go! 🎉
    `.trim();
  }

  createLoadingAnimation(stage: number = 0): string {
    const animations = [
      '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'
    ];
    
    return animations[stage % animations.length];
  }
}