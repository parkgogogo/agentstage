import { join, resolve } from 'pathe';
import { existsSync } from 'fs';

export function getProjectDir(): string {
  const cwd = process.cwd();
  
  // 检查当前目录是否是 Agentstage 项目
  if (existsSync(join(cwd, 'package.json'))) {
    return cwd;
  }
  
  throw new Error('Not an Agentstage project. Run `agentstage init` first.');
}

export function getPidFile(): string {
  return join(getProjectDir(), '.agentstage', 'pid');
}

export function getPagesDir(): string {
  // 支持两种结构：app/routes/pages/ 或 src/pages/
  const projectDir = getProjectDir();
  
  if (existsSync(join(projectDir, 'app', 'routes', 'pages'))) {
    return join(projectDir, 'app', 'routes', 'pages');
  }
  
  if (existsSync(join(projectDir, 'src', 'pages'))) {
    return join(projectDir, 'src', 'pages');
  }
  
  throw new Error('Pages directory not found');
}
