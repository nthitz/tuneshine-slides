#!/usr/bin/env node

import "dotenv/config";
import { parseArgs } from "./lib/cli.js";
import { appState } from "./lib/dashboard-state.js";
import { runDashboard } from "./lib/dashboard-runner.js";

const options = parseArgs(process.argv.slice(2));
appState.enabled = options.startEnabled;

await runDashboard(options);
