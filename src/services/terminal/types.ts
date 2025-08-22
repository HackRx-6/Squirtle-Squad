export interface TerminalExecutionOptions {
  timeout?: number; // in milliseconds
  workingDirectory?: string;
  environment?: Record<string, string>;
  shell?: string; // e.g., '/bin/bash', '/bin/sh'
  maxOutputSize?: number; // max output size in bytes
  fileUrl?: string; // URL to download and execute code file
  runtime?: 'auto' | 'node' | 'python' | 'bash' | 'deno' | 'bun'; // runtime to use for file execution
}

export interface TerminalExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  command: string;
  workingDirectory: string;
  executionTime: number; // in milliseconds
  timedOut: boolean;
  error?: string;
}

export interface TerminalServiceConfig {
  defaultTimeout: number;
  defaultMaxOutputSize: number;
  allowedCommands?: string[]; // if provided, only these commands are allowed
  blockedCommands: string[]; // commands that are explicitly blocked
  allowShellExpansion: boolean;
  maxConcurrentExecutions: number;
}
