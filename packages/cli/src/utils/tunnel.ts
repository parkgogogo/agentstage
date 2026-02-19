/**
 * Cloudflare Tunnel management for exposing local dev server
 */

import { spawn, type ChildProcess } from 'child_process';
import { findCloudflared } from './cloudflared.js';
import consola from 'consola';
import c from 'picocolors';

export interface Tunnel {
  /** Public URL assigned by Cloudflare */
  url: string;
  /** Stop the tunnel */
  stop: () => Promise<void>;
}

interface TunnelMessage {
  event?: string;
  url?: string;
  hostname?: string;
}

/**
 * Start a Cloudflare Tunnel to expose local port
 */
export async function startTunnel(localPort: number): Promise<Tunnel> {
  const cloudflared = await findCloudflared();
  if (!cloudflared) {
    throw new Error(
      'cloudflared not found in PATH. Install it to use --tunnel: ' +
        'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'
    );
  }

  return new Promise((resolve, reject) => {
    let url: string | null = null;
    let stderr = '';

    // Start cloudflared tunnel with JSON output
    const proc = spawn(
      cloudflared,
      ['tunnel', '--url', `http://localhost:${localPort}`, '--metrics', 'localhost:0', '--output', 'json'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      }
    );

    // cloudflared outputs to stderr (even for JSON output mode), so parse stderr for URL
    proc.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        stderr += line + '\n';
        // Try to extract URL from message field (JSON format)
        try {
          const msg = JSON.parse(line);
          if (msg.message) {
            const urlMatch = msg.message.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/);
            if (urlMatch && !url) {
              url = urlMatch[1];
              // Resolve immediately once we have the URL
              resolve({
                url: url!,
                stop: () => stopTunnel(proc),
              });
            }
          }
        } catch {
          // Not JSON, try plain text URL match
          const match = line.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/);
          if (match && !url) {
            url = match[1];
            resolve({
              url: url!,
              stop: () => stopTunnel(proc),
            });
          }
        }
      }
    });

    // Ignore stdout (cloudflared doesn't use it for tunnel info)
    proc.stdout?.on('data', () => {
      // cloudflared outputs everything to stderr
    });

    // Handle process exit before URL is found
    proc.on('exit', (code) => {
      if (!url) {
        reject(
          new Error(
            `cloudflared exited${code ? ` with code ${code}` : ''}${stderr ? `: ${stderr}` : ''}`
          )
        );
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start cloudflared: ${err.message}`));
    });

    // Timeout after 60 seconds (cloudflared can take time to establish connection)
    setTimeout(() => {
      if (!url) {
        proc.kill();
        reject(new Error(`Timeout waiting for tunnel URL. stderr: ${stderr}`));
      }
    }, 60000);
  });
}

/**
 * Stop a running tunnel
 */
async function stopTunnel(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.killed || proc.exitCode !== null) {
      resolve();
      return;
    }

    proc.on('exit', () => resolve());
    proc.kill('SIGTERM');

    // Force kill after 5 seconds
    setTimeout(() => {
      if (!proc.killed && proc.exitCode === null) {
        proc.kill('SIGKILL');
      }
      resolve();
    }, 5000);
  });
}

/**
 * Check if tunnel can be started (cloudflared available)
 */
export async function canStartTunnel(): Promise<boolean> {
  const cloudflared = await findCloudflared();
  return cloudflared !== null;
}

/**
 * Print tunnel info to console
 */
export function printTunnelInfo(url: string): void {
  console.log();
  console.log(c.green('🌐 Public URL: ') + c.cyan(c.underline(url)));
  console.log(c.dim('   ( anyone with this link can access your local server )'));
  console.log();
}
