import { join, resolve } from 'pathe';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';

// CLI 配置目录
export const CLI_CONFIG_DIR = join(homedir(), '.config', 'agentstage');
export const WORKSPACE_FILE = join(CLI_CONFIG_DIR, 'workspace');

// 默认工作目录
export const DEFAULT_WORKSPACE = join(homedir(), '.agentstage');

/**
 * 获取当前工作目录
 */
export async function getWorkspaceDir(): Promise<string> {
  // 1. 从配置文件读取
  try {
    const workspace = await readFile(WORKSPACE_FILE, 'utf8');
    if (workspace && existsSync(workspace.trim())) {
      return workspace.trim();
    }
  } catch {
    // 配置文件不存在
  }
  
  // 2. 检查当前目录是否有 .agentstage
  const currentDir = join(process.cwd(), '.agentstage');
  if (existsSync(currentDir)) {
    return currentDir;
  }
  
  // 3. 检查默认目录是否存在
  if (existsSync(DEFAULT_WORKSPACE)) {
    return DEFAULT_WORKSPACE;
  }
  
  // 4. 没有初始化
  throw new Error(
    'No workspace found. Run `agentstage init` first, or cd to a directory with .agentstage/'
  );
}

/**
 * 设置工作目录
 */
export async function setWorkspaceDir(dir: string): Promise<void> {
  await mkdir(CLI_CONFIG_DIR, { recursive: true });
  await writeFile(WORKSPACE_FILE, resolve(dir));
}

/**
 * 获取 PID 文件路径
 */
export async function getPidFile(): Promise<string> {
  const workspace = await getWorkspaceDir();
  return join(workspace, '.agentstage', 'pid');
}

/**
 * 获取 pages 目录（用于文件存储）
 */
export async function getPagesDir(): Promise<string> {
  const workspace = await getWorkspaceDir();

  // New Vite template structure (src/routes for TanStack Router)
  if (existsSync(join(workspace, 'src', 'routes'))) {
    return join(workspace, 'src', 'pages');
  }

  // Legacy Vite template structure
  if (existsSync(join(workspace, 'src', 'pages'))) {
    return join(workspace, 'src', 'pages');
  }

  throw new Error('Routes directory not found at src/routes');
}

// 运行时配置文件路径
export async function getRuntimeConfigFile(): Promise<string> {
  const workspace = await getWorkspaceDir();
  return join(workspace, '.agentstage', 'runtime.json');
}

// 运行时配置接口
export interface RuntimeConfig {
  pid: number;
  port: number;
  startedAt: string;
  tunnelUrl?: string;
}

/**
 * 读取运行时配置
 */
export async function readRuntimeConfig(): Promise<RuntimeConfig | null> {
  const configFile = await getRuntimeConfigFile();
  if (!existsSync(configFile)) {
    return null;
  }
  try {
    const content = await readFile(configFile, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 保存运行时配置
 */
export async function saveRuntimeConfig(config: RuntimeConfig): Promise<void> {
  const configFile = await getRuntimeConfigFile();
  await mkdir(join(configFile, '..'), { recursive: true });
  await writeFile(configFile, JSON.stringify(config, null, 2));
}

/**
 * 删除运行时配置
 */
export async function removeRuntimeConfig(): Promise<void> {
  const configFile = await getRuntimeConfigFile();
  if (existsSync(configFile)) {
    await writeFile(configFile, ''); // 清空而不是删除，便于检查
  }
}

/**
 * 检查是否已初始化
 */
export function isInitialized(): boolean {
  // 检查配置文件是否存在
  if (!existsSync(WORKSPACE_FILE)) {
    return false;
  }
  try {
    const workspace = readFileSync(WORKSPACE_FILE, 'utf8');
    // 检查工作目录是否有 package.json（项目标志）
    return existsSync(join(workspace.trim(), 'package.json'));
  } catch {
    return false;
  }
}

/**
 * 检查服务是否正在运行
 */
export async function isRunning(): Promise<boolean> {
  const config = await readRuntimeConfig();
  if (!config) return false;

  try {
    process.kill(config.pid, 0);
    return true;
  } catch {
    return false;
  }
}

import { readFileSync } from 'fs';
