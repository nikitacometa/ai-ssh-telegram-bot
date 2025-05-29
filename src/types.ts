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
  serverSetup?: ServerSetupState;
  activeCommands?: Map<string, ActiveCommand>;
}

export interface ServerSetupState {
  step: 'hostname' | 'port' | 'username' | 'auth_method' | 'password' | 'private_key' | 'confirm';
  serverData: Partial<SSHConfig & { name: string }>;
}

export interface ActiveCommand {
  messageId: number;
  process?: any;
  startTime: number;
  command: string;
  serverId: string;
}