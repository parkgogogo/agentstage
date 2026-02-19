import { Command } from 'commander';
import consola from 'consola';
import c from 'picocolors';
import { readdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'pathe';
import { mkdir } from 'fs/promises';
import { getWorkspaceDir, isInitialized, readRuntimeConfig } from '../../utils/paths.js';

interface PageManifest {
  generatedAt: string;
  baseUrl: string;
  pages: Record<string, {
    route: string;
    file: string;
    url: string;
    bridge: {
      websocketUrl: string;
      pageId: string;
      storeKey: string;
    };
  }>;
}

export const pageManifestCommand = new Command('manifest')
  .description('Generate pages manifest JSON for Agent consumption')
  .option('-o, --output <path>', 'Output file path', '.agentstage/pages-manifest.json')
  .option('--stdout', 'Output to stdout instead of file')
  .action(async (options) => {
    if (!isInitialized()) {
      consola.error('Project not initialized. Please run `agentstage dev init` first.');
      process.exit(1);
    }

    const workspaceDir = await getWorkspaceDir();
    const routesDir = join(workspaceDir, 'src', 'routes');
    const config = await readRuntimeConfig();

    if (!existsSync(routesDir)) {
      consola.error('No routes directory found');
      process.exit(1);
    }

    const entries = await readdir(routesDir, { withFileTypes: true });
    const pages = entries
      .filter((e) => e.isFile() && e.name.endsWith('.tsx'))
      .map((e) => e.name.replace('.tsx', ''))
      .filter((name) => name !== '__root');

    const port = config?.port || 3000;
    const baseUrl = config?.tunnelUrl || `http://localhost:${port}`;
    const wsUrl = `ws://localhost:${port}/_bridge`;

    const manifest: PageManifest = {
      generatedAt: new Date().toISOString(),
      baseUrl,
      pages: {},
    };

    for (const page of pages) {
      manifest.pages[page] = {
        route: `/${page}`,
        file: `src/routes/${page}.tsx`,
        url: `${baseUrl}/${page}`,
        bridge: {
          websocketUrl: wsUrl,
          pageId: page,
          storeKey: 'main',
        },
      };
    }

    const json = JSON.stringify(manifest, null, 2);

    if (options.stdout) {
      console.log(json);
    } else {
      const outputPath = join(workspaceDir, options.output);
      await mkdir(join(outputPath, '..'), { recursive: true });
      await writeFile(outputPath, json);

      consola.success('Pages manifest generated');
      console.log(`  Output: ${c.cyan(outputPath)}`);
      console.log(`  Pages:  ${c.gray(pages.length)}`);
      console.log();
      console.log(c.dim('Use this manifest in your Agent code:'));
      console.log(c.dim(`  import manifest from '${options.output}';`));
    }
  });
