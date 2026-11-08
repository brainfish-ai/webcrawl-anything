#!/usr/bin/env node
import { runWebcrawl } from "./run-cli.mjs";

const { code } = await runWebcrawl(["doctor"], { inherit: true });
process.exit(code);
