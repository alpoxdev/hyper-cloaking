#!/usr/bin/env node
import { runCli } from '../engine/cli.mjs';

process.exitCode = await runCli();
