export interface MCPServerConfig {
  id: string;
  name: string;
  type: string;
  config: Record<string, any>;
  enabled: boolean;
}

export interface SSHConfig {
  host: string;
  username: string;
  password?: string;
  privateKeyPath?: string;
  port?: number;
}

export interface CommandConfirmation {
  userId: number;
  command: string;
  serverId: string;
  timestamp: number;
  confirmed: boolean;
}

export interface UserSession {
  userId: number;
  activeServer?: string;
  pendingConfirmation?: CommandConfirmation;
  commandHistory: string[];
  lastActivity: number;
  preferences: {
    quickCommands: boolean;
    verboseOutput: boolean;
  };
}