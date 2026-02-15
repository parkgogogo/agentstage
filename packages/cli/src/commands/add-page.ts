import { Command } from 'commander';
import * as p from '@clack/prompts';
import consola from 'consola';
import c from 'picocolors';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { getPagesDir } from '../utils/paths.js';

export const addPageCommand = new Command('add-page')
  .description('Add a new page')
  .argument('<name>', 'Page name (e.g., counter, user-profile)')
  .action(async (name) => {
    // 验证名称
    if (!/^[a-z0-9-]+$/.test(name)) {
      consola.error('Page name must be lowercase letters, numbers, and hyphens');
      process.exit(1);
    }
    
    try {
      const pagesDir = getPagesDir();
      const pageDir = join(pagesDir, name);
      
      if (existsSync(pageDir)) {
        const overwrite = await p.confirm({
          message: `Page "${name}" already exists. Overwrite?`,
          initialValue: false,
        });
        if (p.isCancel(overwrite) || !overwrite) {
          consola.info('Cancelled');
          return;
        }
      }
      
      // 创建页面目录和文件
      await mkdir(pageDir, { recursive: true });
      
      const pageContent = `import React from 'react';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/p/${name}')({
  component: ${toPascalCase(name)}Page,
});

function ${toPascalCase(name)}Page() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">${toTitleCase(name)}</h1>
      <p className="mt-4">Edit this page at pages/${name}/page.tsx</p>
    </div>
  );
}
`;
      
      await writeFile(join(pageDir, 'page.tsx'), pageContent);
      
      consola.success(`Page "${name}" created`);
      console.log(`  Location: ${c.cyan(join('pages', name))}`);
      console.log(`  URL: ${c.cyan(`http://localhost:3000/p/${name}`)}`);
      
    } catch (error: any) {
      consola.error('Failed to create page:', error.message);
      process.exit(1);
    }
  });

function toPascalCase(str: string): string {
  return str
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function toTitleCase(str: string): string {
  return str
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
