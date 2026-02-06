import { exec } from 'child_process';

/**
 * Execute a command that is intended to run on Windows.
 *
 * By default this runs the command locally. If WIN_EXEC_SSH_HOST is set,
 * the command is proxied over SSH to a remote Windows machine.
 */
export function execWindows(command, options = {}) {
  const sshHost = process.env.WIN_EXEC_SSH_HOST;
  const sshUser = process.env.WIN_EXEC_SSH_USER;

  const finalCommand = sshHost
    ? `ssh ${sshUser ? `${sshUser}@` : ''}${sshHost} ${JSON.stringify(command)}`
    : command;

  return new Promise((resolve, reject) => {
    exec(
      finalCommand,
      {
        windowsHide: true,
        timeout: Number(process.env.WIN_EXEC_TIMEOUT_MS || 30000),
        ...options
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          return reject(error);
        }

        resolve({ stdout, stderr });
      }
    );
  });
}
