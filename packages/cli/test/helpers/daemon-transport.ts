import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import {
  defaultDaemonUserRoot,
  delay
} from "./daemon-cli.ts";

const cliEntry = path.resolve("packages/cli/src/index.ts");

export function spawnDaemonCli(rootDir: string, args: ReadonlyArray<string>) {
  return spawn(process.execPath, [cliEntry, "--root", rootDir, ...args], {
    env: {
      ...process.env,
      HOME: path.join(rootDir, ".home"),
      GIT_CONFIG_GLOBAL: "/dev/null",
      HARNESS_DAEMON_MODE: "direct",
      HARNESS_DAEMON_USER_ROOT: defaultDaemonUserRoot(rootDir)
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
}

export function runDaemonCliProcess(
  rootDir: string,
  args: ReadonlyArray<string>,
  stdin = ""
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnDaemonCli(rootDir, args);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

export async function connectSocketWhenReady(endpoint: string, timeoutMs = 8_000): Promise<net.Socket> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      return await connectSocket(endpoint);
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(25);
    }
  }
  throw new Error(`daemon socket did not become ready: ${endpoint}`);
}

export function connectSocket(endpoint: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

export function listen(server: net.Server, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

export function closeServer(server: net.Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
