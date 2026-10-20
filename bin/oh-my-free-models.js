#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const cliPath = join(here, "..", "dist", "cli", "index.js")

if (!existsSync(cliPath)) {
  console.error("oh-my-free-models is not built yet.")
  console.error("Run: bun install --ignore-scripts && OMO_SKIP_MATERIALIZE=1 OMO_BUILD_PROFILE=opencode bun run build")
  process.exit(1)
}

await import(pathToFileURL(cliPath).href)
