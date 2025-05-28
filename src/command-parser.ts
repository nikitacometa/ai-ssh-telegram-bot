export interface ParsedCommand {
  type: 'bash' | 'system' | 'unknown';
  command?: string;
  intent?: string;
}

export class CommandParser {
  private bashKeywords = [
    'run', 'execute', 'exec', 'show', 'list', 'check', 'get', 'display',
    'find', 'search', 'create', 'delete', 'remove', 'update', 'install',
    'start', 'stop', 'restart', 'status', 'ping', 'test', 'cat', 'echo',
    'grep', 'ps', 'top', 'df', 'du', 'free', 'whoami', 'pwd', 'cd',
    'mkdir', 'rmdir', 'touch', 'cp', 'mv', 'chmod', 'chown', 'kill',
    'systemctl', 'service', 'docker', 'kubectl', 'git', 'npm', 'yarn'
  ];

  private systemCommands = [
    '/start', '/help', '/servers', '/connect', '/disconnect', '/addserver',
    '/removeserver', '/status', '/cancel'
  ];

  parse(message: string): ParsedCommand {
    const trimmed = message.trim();
    
    // Check if it's a system command
    if (trimmed.startsWith('/')) {
      const command = trimmed.split(' ')[0].toLowerCase();
      if (this.systemCommands.includes(command)) {
        return { type: 'system', command: trimmed };
      }
    }

    // Try to extract bash command
    const bashCommand = this.extractBashCommand(trimmed);
    if (bashCommand) {
      return { type: 'bash', command: bashCommand };
    }

    // Check for bash-like intentions
    const lowerMessage = trimmed.toLowerCase();
    for (const keyword of this.bashKeywords) {
      if (lowerMessage.includes(keyword)) {
        return { 
          type: 'bash', 
          intent: trimmed,
          command: this.inferCommand(trimmed)
        };
      }
    }

    return { type: 'unknown', intent: trimmed };
  }

  private extractBashCommand(message: string): string | undefined {
    // Look for quoted commands
    const quotedMatch = message.match(/["'](.+?)["']/);
    if (quotedMatch) {
      return quotedMatch[1];
    }

    // Look for backtick commands
    const backtickMatch = message.match(/`(.+?)`/);
    if (backtickMatch) {
      return backtickMatch[1];
    }

    // Look for explicit command patterns
    const patterns = [
      /(?:run|execute|exec)\s+(.+)/i,
      /(?:please\s+)?(?:can you\s+)?(?:run|execute)\s+(.+)/i,
      /^(ls|pwd|whoami|df|ps|top|free|uptime|date|uname)(?:\s|$)/i
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        return match[1] || match[0];
      }
    }

    return undefined;
  }

  private inferCommand(message: string): string | undefined {
    const lower = message.toLowerCase();
    
    const inferences: { [key: string]: string } = {
      'list files': 'ls -la',
      'show files': 'ls -la',
      'current directory': 'pwd',
      'who am i': 'whoami',
      'disk space': 'df -h',
      'memory usage': 'free -h',
      'running processes': 'ps aux',
      'system info': 'uname -a',
      'network connections': 'netstat -tuln',
      'check internet': 'ping -c 4 google.com',
      'show date': 'date',
      'show time': 'date',
      'cpu usage': 'top -b -n 1'
    };

    for (const [key, cmd] of Object.entries(inferences)) {
      if (lower.includes(key)) {
        return cmd;
      }
    }

    return undefined;
  }
}