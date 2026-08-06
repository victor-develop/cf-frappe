import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

const firstPort = 8_787;
const lastPort = 8_797;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const migrationExitCode = await run(npmCommand, ["run", "d1:migrate:local"]);
if (migrationExitCode !== 0) {
  process.exitCode = migrationExitCode;
} else {
  const port = await firstAvailablePort(firstPort, lastPort);
  if (port === null) {
    console.error(`No available local port between ${String(firstPort)} and ${String(lastPort)}.`);
    process.exitCode = 1;
  } else {
    if (port !== firstPort) {
      console.log(`Port ${String(firstPort)} is in use; using ${String(port)} instead.`);
    }
    console.log(`ReturnsOS: http://localhost:${String(port)}/returns`);
    console.log(`Demo controls: http://localhost:${String(port)}/demo`);
    process.exitCode = await run(npmCommand, ["run", "dev", "--", "--port", String(port)]);
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function firstAvailablePort(start, end) {
  for (let port = start; port <= end; port += 1) {
    if (await portIsAvailable(port)) return port;
  }
  return null;
}

function portIsAvailable(port) {
  const listenerExists = portHasListener(port);
  if (listenerExists !== null) return Promise.resolve(!listenerExists);

  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

function portHasListener(port) {
  const result = spawnSync("lsof", ["-nP", `-iTCP:${String(port)}`, "-sTCP:LISTEN"], {
    stdio: "ignore"
  });
  if (result.error?.code === "ENOENT") return null;
  if (result.error !== undefined) return true;
  return result.status === 0;
}
