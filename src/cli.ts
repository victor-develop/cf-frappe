#!/usr/bin/env node
/// <reference types="node" />
import process from "node:process";
import { runCli } from "./cli/command.js";

try {
  const fetchImpl = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined;
  process.exitCode = await runCli(process.argv.slice(2), {
    cwd: () => process.cwd(),
    env: (name) => process.env[name],
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
    stderr: process.stderr,
    stdout: process.stdout
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`cf-frappe: ${message}\n`);
  process.exitCode = 1;
}
