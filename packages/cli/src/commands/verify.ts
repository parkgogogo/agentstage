import { Command } from 'commander';
import { execa } from 'execa';
import consola from 'consola';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'pathe';
import picocolors from 'picocolors';
import { getWorkspaceDir, readRuntimeConfig, isInitialized } from '../utils/paths.js';

interface CheckResult {
  name: string;
  passed: boolean;
  errors?: string[];
  warnings?: string[];
}

export const verifyCommand = new Command('verify')
  .description('Verify page(s) before delivery - 交付前验收检查')
  .argument('[page]', 'Page to verify (default: all pages)')
  .option('--ci', 'CI mode (non-interactive, exit with error code)')
  .action(async (page, options) => {
    if (!isInitialized()) {
      consola.error('No workspace found. Run `agentstage init` first.');
      process.exit(1);
    }

    let workspace: string;
    try {
      workspace = await getWorkspaceDir();
    } catch (error: any) {
      consola.error(error.message);
      process.exit(1);
    }

    const checks: CheckResult[] = [];

    // 1. TypeScript 编译检查
    checks.push(await checkTypeScript(workspace));

    // 2. 路由检查
    if (page) {
      checks.push(await checkRoute(workspace, page));
    } else {
      checks.push(await checkAllRoutes(workspace));
    }

    // 3. 运行时检查
    checks.push(await checkRuntime(workspace, page));

    // 4. 输出报告
    printReport(checks, options.ci);

    // CI 模式下有问题就退出
    if (options.ci && checks.some(c => !c.passed)) {
      process.exit(1);
    }
  });

async function checkTypeScript(workspace: string): Promise<CheckResult> {
  consola.info('Checking TypeScript compilation...');
  
  try {
    // 运行类型检查（忽略 node_modules 错误）
    const { stderr } = await execa(
      'npx', 
      ['tsc', '--noEmit', '--skipLibCheck'], 
      { 
        cwd: workspace,
        reject: false,
        timeout: 60000
      }
    );
    
    if (stderr && stderr.includes('error')) {
      const errors = parseTSErrors(stderr);
      return {
        name: 'TypeScript 编译',
        passed: false,
        errors: errors.slice(0, 5) // 只显示前5个
      };
    }
    
    return { name: 'TypeScript 编译', passed: true };
  } catch (error: any) {
    return {
      name: 'TypeScript 编译',
      passed: false,
      errors: [`无法运行 TypeScript 检查: ${error.message}`]
    };
  }
}

function parseTSErrors(output: string): string[] {
  const errors: string[] = [];
  const lines = output.split('\n');
  
  for (const line of lines) {
    // 匹配 TS 错误格式: file(line,col): error TSxxxx: message
    const match = line.match(/(.+?)\((\d+),(\d+)\):\s+error\s+TS\d+:\s+(.+)/);
    if (match) {
      const [, file, lineNum, col, message] = match;
      const shortFile = file.replace(process.cwd(), '');
      errors.push(`${shortFile}:${lineNum}:${col} - ${message}`);
    }
  }
  
  return errors.length > 0 ? errors : [output.slice(0, 200)];
}

async function checkRoute(workspace: string, pageId: string): Promise<CheckResult> {
  const routeFile = resolve(workspace, 'src/routes', `${pageId}.tsx`);
  
  if (!existsSync(routeFile)) {
    return {
      name: `路由检查 (${pageId})`,
      passed: false,
      errors: [`页面文件不存在: src/routes/${pageId}.tsx`]
    };
  }
  
  // 检查文件内容
  const content = readFileSync(routeFile, 'utf8');
  const issues: string[] = [];
  
  if (!content.includes('export const Route')) {
    issues.push('缺少 Route 导出');
  }
  
  // 检查 HTML 实体（常见问题）
  if (content.includes('&quot;') || content.includes('&apos;')) {
    issues.push('发现 HTML 实体 (&quot;/&apos;)，可能导致编译错误');
  }
  
  // 检查是否有未闭合的括号
  const openBraces = (content.match(/{/g) || []).length;
  const closeBraces = (content.match(/}/g) || []).length;
  if (openBraces !== closeBraces) {
    issues.push(`括号不匹配: {${openBraces} 个, }${closeBraces} 个`);
  }
  
  return {
    name: `路由检查 (${pageId})`,
    passed: issues.length === 0,
    errors: issues,
    warnings: issues.length > 0 ? ['这些问题可能导致页面无法正常工作'] : undefined
  };
}

async function checkAllRoutes(workspace: string): Promise<CheckResult> {
  const routesDir = resolve(workspace, 'src/routes');
  
  if (!existsSync(routesDir)) {
    return {
      name: '路由检查 (all)',
      passed: false,
      errors: ['路由目录不存在: src/routes']
    };
  }
  
  return {
    name: '路由检查 (all)',
    passed: true,
    warnings: ['建议逐个页面检查: agentstage verify <page>']
  };
}

async function checkRuntime(workspace: string, pageId?: string): Promise<CheckResult> {
  const config = await readRuntimeConfig();
  
  if (!config) {
    return {
      name: '运行时检查',
      passed: false,
      errors: ['Server 未运行'],
      warnings: ['请先执行: agentstage start']
    };
  }
  
  // 检查进程是否真的存在
  try {
    process.kill(config.pid, 0);
  } catch {
    return {
      name: '运行时检查',
      passed: false,
      errors: [`Server 进程 (${config.pid}) 不存在，可能已崩溃`],
      warnings: ['请重启: agentstage restart']
    };
  }
  
  // HTTP 检查
  const url = pageId
    ? `http://localhost:${config.port || 3000}/${pageId}`
    : `http://localhost:${config.port || 3000}/`;
  
  try {
    const response = await fetch(url, { 
      signal: AbortSignal.timeout(5000) 
    });
    
    if (!response.ok) {
      return {
        name: '运行时检查',
        passed: false,
        errors: [`页面返回 ${response.status} ${response.statusText}`]
      };
    }
    
    // 检查页面内容是否包含 Vite 错误
    const html = await response.text();
    if (html.includes('[plugin:') && html.includes('error')) {
      return {
        name: '运行时检查',
        passed: false,
        errors: ['页面包含 Vite 错误信息，请检查浏览器控制台']
      };
    }
    
    return {
      name: '运行时检查',
      passed: true,
      warnings: pageId ? undefined : ['建议检查具体页面: agentstage verify <page>']
    };
  } catch (error: any) {
    return {
      name: '运行时检查',
      passed: false,
      errors: [`无法访问页面: ${error.message}`]
    };
  }
}

function printReport(checks: CheckResult[], ci: boolean) {
  const { green, red, yellow, bold } = picocolors;
  
  console.log('\n' + bold('📋 交付验收检查报告'));
  console.log('─'.repeat(60));
  
  let errorCount = 0;
  let warningCount = 0;
  
  for (const check of checks) {
    const icon = check.passed ? green('✅') : red('❌');
    console.log(`\n${icon} ${bold(check.name)}`);
    
    if (check.errors && check.errors.length > 0) {
      errorCount += check.errors.length;
      for (const error of check.errors) {
        console.log(`   ${red('❌')} ${error}`);
      }
    }
    
    if (check.warnings && check.warnings.length > 0) {
      warningCount += check.warnings.length;
      for (const warning of check.warnings) {
        console.log(`   ${yellow('⚠️')} ${warning}`);
      }
    }
  }
  
  console.log('─'.repeat(60));
  
  if (errorCount > 0) {
    console.log('\n' + red(bold(`❌ 检查未通过 (${errorCount} 个错误)`)));
    if (!ci) {
      console.log('\n' + yellow('💡 建议修复步骤:'));
      console.log('   1. 根据错误信息修改代码');
      console.log('   2. 重新运行 agentstage verify');
      console.log('   3. 确认所有检查通过后再交付');
    }
  } else if (warningCount > 0) {
    console.log('\n' + yellow(bold(`⚠️ 检查通过但有警告 (${warningCount} 个)`)));
  } else {
    console.log('\n' + green(bold('✅ 所有检查通过，可以交付！')));
  }
}
