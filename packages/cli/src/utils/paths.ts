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
 * 获取 pages 目录
 */
export async function getPagesDir(): Promise<string> {
  const workspace = await getWorkspaceDir();
  
  if (existsSync(join(workspace, 'app', 'routes', 'pages'))) {
    return join(workspace, 'app', 'routes', 'pages');
  }
  
  if (existsSync(join(workspace, 'src', 'pages'))) {
    return join(workspace, 'src', 'pages');
  }
  
  throw new Error('Pages directory not found');
}
