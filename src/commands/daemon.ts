/**
 * CLI command for daemon lifecycle:
 *   opencli daemon stop — graceful shutdown
 */

import { styleText } from 'node:util';
import { fetchDaemonStatus, requestDaemonShutdown } from '../browser/daemon-client.js';

export async function daemonStop(): Promise<void> {
  const status = await fetchDaemonStatus();
  if (!status) {
    console.log(styleText('dim', 'Daemon is not running.'));
    return;
  }

  const ok = await requestDaemonShutdown();
  if (ok) {
    console.log(styleText('green', 'Daemon stopped.'));
  } else {
    console.error(styleText('red', 'Failed to stop daemon.'));
    process.exitCode = 1;
  }
}
