import { $ } from "bun";

export class ShellError extends Error {
  constructor(
    public command: string,
    public exitCode: number,
    public stderr: string,
  ) {
    super(`Command failed (exit ${exitCode}): ${command}\n${stderr}`);
    this.name = "ShellError";
  }
}

export async function exec(command: string[]): Promise<string> {
  const proc = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    throw new ShellError(command.join(" "), exitCode, stderr.trim());
  }

  return stdout.trim();
}

export async function execShell(command: string): Promise<string> {
  const result = await $`sh -c ${command}`.quiet().nothrow();
  const stdout = result.stdout.toString().trim();
  const stderr = result.stderr.toString().trim();

  if (result.exitCode !== 0) {
    throw new ShellError(command, result.exitCode, stderr);
  }

  return stdout;
}
