#!/usr/bin/env node
/// <reference types="node" />
import process from "node:process";
import { runCli } from "./cli/command.js";

try {
  process.exitCode = await runCli(process.argv.slice(2), {
    cwd: () => process.cwd(),
    stderr: process.stderr,
    stdout: process.stdout
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`cf-frappe: ${message}\n`);
  process.exitCode = 1;
}
