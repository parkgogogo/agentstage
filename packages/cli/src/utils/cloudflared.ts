/**
 * Cloudflared installation detection and management
 */

import { execa } from 'execa';
import c from 'picocolors';

export interface CloudflaredInfo {
  installed: boolean;
  version?: string;
  installCommand: string;
  docsUrl: string;
}

/**
 * Check if cloudflared is installed and get version
 */
export async function checkCloudflared(): Promise<CloudflaredInfo> {
  try {
    const result = await execa('cloudflared', ['--version']);
    const version = result.stdout.trim().split('\n')[0];
    return {
      installed: true,
      version,
      installCommand: '',
      docsUrl: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
    };
  } catch {
    return {
      installed: false,
      installCommand: getInstallCommand(),
      docsUrl: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
    };
  }
}

/**
 * Get installation command for current platform
 */
function getInstallCommand(): string {
  switch (process.platform) {
    case 'darwin':
      return 'brew install cloudflared';
    case 'linux':
      // Try to detect package manager
      return 'curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared && chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/';
    case 'win32':
      return 'choco install cloudflared  # or: winget install --id Cloudflare.cloudflared';
    default:
      return 'See docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/';
  }
}

/**
 * Print installation instructions
 */
export function printInstallInstructions(info: CloudflaredInfo): void {
  console.log();
  console.log(c.yellow('⚠️  Cloudflare Tunnel (cloudflared) is not installed'));
  console.log();
  console.log(c.dim('To expose your local server to the internet with a public URL,'));
  console.log(c.dim('you need to install cloudflared:'));
  console.log();
  console.log(c.cyan(`  ${info.installCommand}`));
  console.log();
  console.log(c.dim('Or download from: ') + c.underline(info.docsUrl));
  console.log();
  console.log(c.dim('Note: Local development works without cloudflared.'));
  console.log(c.dim('      The --tunnel flag will be ignored if cloudflared is not available.'));
  console.log();
}

/**
 * Find cloudflared executable path
 */
export async function findCloudflared(): Promise<string | null> {
  try {
    // Try to find in PATH
    const result = await execa('which', ['cloudflared']);
    return result.stdout.trim();
  } catch {
    // Try common locations
    const commonPaths = [
      '/usr/local/bin/cloudflared',
      '/usr/bin/cloudflared',
      `${process.env.HOME}/.local/bin/cloudflared`,
      `${process.env.HOME}/bin/cloudflared`,
    ];

    for (const path of commonPaths) {
      try {
        await execa('test', ['-x', path]);
        return path;
      } catch {
        // Continue to next path
      }
    }

    return null;
  }
}
