# Free models

`oh-my-free-models` is a modified, non-commercial fork of
[oh-my-opencode](https://github.com/code-yeongyu/oh-my-openagent). It treats the
zero-cost models that OpenCode offers as the default model pool:

- scan the current free catalog from [models.dev](https://models.dev);
- score every free model against the work each built-in agent and category does;
- write the best primary + fallback chain for every role;
- detect when a configured free model disappears, rescan, and let you choose a
  replacement or keep the model with an official provider API key.

The CLI never asks for, stores, or prints an API key.

## Quick start

```bash
# 1. See the current free models and the best work for each one
omfm free scan

# 2. Preview the assignments without writing anything
omfm free apply --dry-run

# 3. Write the assignments to ~/.omo/omo.jsonc
omfm free apply --yes

# 4. Check for expired free models at any time
omfm free status
```

`omfm` is the short binary name; `oh-my-free-models` works too. Running from a
source checkout:

```bash
bun packages/omo-opencode/src/cli/index.ts free scan
```

## Install as an OpenCode plugin

The fork is distributed through GitHub, not npm. Build it and load the built
entry as a local plugin:

```bash
git clone https://github.com/whaterisapanacea/oh-my-free-models.git
cd oh-my-free-models
bun install --ignore-scripts
OMO_SKIP_MATERIALIZE=1 OMO_BUILD_PROFILE=opencode bun run build
```

If HTTPS git or port 22 is blocked, use SSH over port 443:

```bash
git clone ssh://git@ssh.github.com:443/whaterisapanacea/oh-my-free-models.git
```

In `~/.config/opencode/opencode.jsonc`:

```json
{
  "plugin": ["file:///absolute/path/to/oh-my-free-models/dist/index.js"]
}
```

The path must be absolute. Remove `oh-my-openagent` and `oh-my-opencode` from the
plugin array so the upstream package and the fork do not load together. Source
mode without a build is also supported:

```json
{
  "plugin": ["file:///absolute/path/to/oh-my-free-models/packages/omo-opencode/src/index.ts"]
}
```

OpenCode 1.x uses `"plugin"`. OpenCode 2.x uses `"plugins"`, but the fork's V2
entry currently loads as a notice-only stub: its OmO agents, tools, and hooks are
not active. The free-model CLI still works on V2. For the full 19-role harness,
use OpenCode 1.x or OmO Native instead.

### OpenCode 2: native agent overrides

OpenCode 2 has four built-in agents (`build`, `plan`, `general`, `explore`); it
does not have OmO's agents or categories. You can still apply the free-model
choices directly:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode/deepseek-v4.1-flash-free",
  "agents": {
    "build": { "model": "opencode/minimax-m3.1-flash-free" },
    "plan": { "model": "opencode/nemotron-3.5-super-vl-free" },
    "general": { "model": "opencode/deepseek-v4.1-flash-free" },
    "explore": { "model": "opencode/nemotron-3.5-lightning-free" }
  }
}
```

V2 has no fallback chain, so use one model per agent. Verify the resolved models
with `opencode debug agents` and reload with `opencode reload`.

### Check what your OpenCode account actually serves

The models.dev catalog can list free models that your OpenCode account does not
serve. Check `opencode models` before applying. A catalog entry may be free but
still fail with `provider.no-route` when it is not available on your account.
The local cache can be restricted to the served models before `free apply`; run
`free apply --offline` afterwards so the scan does not reintroduce unavailable
models.

Restart OpenCode after changing the plugin entry. The CLI can then be run with
`bun bin/oh-my-free-models.js free ...` from the checkout (or
`bun dist/cli/index.js free ...`), or `omfm free ...` after linking/installing
the package.

## Commands

### `free scan`

```bash
omfm free scan                 # cached catalog (6 hour TTL)
omfm free scan --refresh       # force a live models.dev scan
omfm free scan --offline       # never touch the network
omfm free scan --json          # machine-readable output
omfm free scan --limit 0       # show every model in the model-to-work table
omfm free scan --no-spread     # show pure best fit instead of spread assignments
```

The output has three parts:

1. **FREE MODELS** — every model that currently reports zero input and output
   token cost, with context, output limit, tool support, reasoning support, and
   input modalities.
2. **BEST MODEL BY WORK** — the recommended primary for all 11 agents and 8
   categories.
3. **MODEL → BEST WORK** — for each free model, the roles it fits best. This is
   the "what is this model good for?" view.

### `free apply`

```bash
omfm free apply --dry-run              # print the plan, write nothing
omfm free apply --yes                  # apply without a prompt
omfm free apply --yes --chain 3        # primary + 2 fallbacks per role
omfm free apply --yes --no-spread      # always use the single best model per role
omfm free apply --yes --scope project  # write ./.omo/omo.jsonc instead of the user config
omfm free apply --yes --refresh        # force a live catalog scan first
```

`apply` writes all of the following for each role:

```jsonc
{
  "[opencode]": {
    "agents": {
      "sisyphus": {
        "model": "opencode/...",
        "fallback_models": ["opencode/...", "opencode/..."],
        "models": ["opencode/...", "opencode/...", "opencode/..."]
      }
    },
    "categories": {
      "quick": {
        "model": "opencode/...",
        "fallback_models": ["opencode/..."],
        "models": ["opencode/...", "opencode/..."]
      }
    },
    "runtime_fallback": true
  }
}
```

`models` is the canonical ordered chain. `model` and `fallback_models` are kept
in sync because older code paths and the runtime-fallback hook read them. If
`runtime_fallback` is not set at all, `apply` enables it; an explicit user value
is never overwritten.

The previous config is backed up next to the target file.

### `free status`

```bash
omfm free status                    # report health and new/removed models
omfm free status --check            # exit 2 when a role is expired
omfm free status --refresh          # force a live scan
omfm free status --fix              # choose replacements interactively
omfm free status --replace-expired  # replace every expired role
omfm free status --keep-expired     # keep expired models and print API key guidance
omfm free status --json
```

A role is:

- **ok** — every model in its chain is still free;
- **kept** — an expired model was explicitly kept (see below);
- **degraded** — the primary is gone but at least one fallback is still free;
- **expired** — the entire chain is gone.

`status` also lists free models that appeared since the last `apply`, so a new
model can be picked up by running `apply` again.

## Handling an expired free model

When a provider stops offering a free model, `free status` rescans the catalog
and ranks the models that are free *now* for the affected role. There are two
paths:

### Option A — accept the recommended replacement

```bash
omfm free status --fix
```

Choose **Use the recommended replacement**. The CLI rewrites that role's chain
to the new recommended primary + fallbacks and updates the state file.

For automation:

```bash
omfm free status --replace-expired
```

### Option B — keep the model and use its official API key

Choose **Keep it and add the official API key** (or run
`omfm free status --keep-expired`). The CLI leaves the config unchanged, records
the model in `keptExpired`, and prints the official provider family, for example:

```
Kept opencode/kimi-k2.5-free.
  Official provider: Moonshot AI (Kimi) (moonshotai, API key env MOONSHOT_API_KEY)
  Run `opencode auth login` and choose the official provider, then point the role at the official model id.
  The CLI never asks for or stores API keys.
```

Then run `opencode auth login`, add the key through OpenCode, and change the
role's `model` / `models` entries to the official provider's model id. A kept
model is reported as **kept** instead of **expired**, so the startup warning
stops nagging.

## How assignment works

Each model is normalized into 0..1 traits:

| trait | source |
| --- | --- |
| `coding` | model family/name prior, reasoning, context |
| `reasoning` | models.dev `reasoning` flag |
| `context` | log-scaled context window (16k .. 1M) |
| `output` | log-scaled output limit (4k .. 256k) |
| `speed` | flash / lightning / mini / quick / preview name signals |
| `lightweight` | small models with short context |
| `toolCall` | models.dev `tool_call` flag |
| `vision` / `video` / `audio` | input modalities |
| `writing` | inverse coding prior plus long context |
| `agentic` | tool use + reasoning + context + coding |

Each role has a weight vector. For example:

- **Sisyphus** — coding 5, agentic 4, reasoning 3, context 3, tools 2, speed 1;
- **Hephaestus** — coding 5, agentic 4, reasoning 4, context 3, tools 2;
- **Oracle / Prometheus / Momus** — reasoning 5, context 4, coding 3, writing 2;
- **Explore** — speed 5, context 4, tools 3, coding 2;
- **Quick** — speed 4, lightweight 4, tools 1, coding 1;
- **Visual Engineering** — vision 5 (required), coding 4, agentic 3;
- **Writing / Artistry** — writing 5, context and reasoning secondary.

Hard requirements are applied first:

- all agent/category roles require tool calling;
- `multimodal-looker` and `visual-engineering` require image input;
- if no model satisfies a requirement, the ranker relaxes it and emits a warning
  rather than leaving the role empty.

`apply` and `scan` use a small diversity penalty (`0.03`) by default. Once a
model becomes the primary of a role, repeating it in another role costs a little
score, so the 19 roles spread across the catalog instead of collapsing onto one
model. This is a tie-breaker, not a replacement for capability: a clearly better
model still wins. Use `--no-spread` for pure best fit.

## Data source and freshness

- Source: `https://models.dev/api.json`, provider `opencode`.
- A model is free only when `cost.input === 0` **and** `cost.output === 0`.
  Missing cost data is never treated as free.
- The catalog is cached for 6 hours in `~/.omo/free-models-cache.json`.
  `--refresh` forces a live scan; `--offline` forces the cache.
- If a live scan fails, the cached catalog is used with a warning. If there is no
  cache, the command fails with a network hint.
- The free catalog changes over time. The count (45 models at the time of
  writing) is not hard-coded.

## State and config locations

| path | purpose |
| --- | --- |
| `~/.omo/omo.jsonc` | user config written by `apply --scope user` (default) |
| `<project>/.omo/omo.jsonc` | project config written by `apply --scope project` |
| `~/.omo/free-models.json` | user assignment state + last catalog snapshot |
| `<project>/.omo/free-models.json` | project assignment state |
| `~/.omo/free-models-cache.json` | shared catalog cache |

`status` reads the state for the same scope. If you applied with
`--scope project`, run `status` with `--scope project -d <project>`.

## Startup warning

The plugin's startup hook reads the **cached** catalog and the user state during
`session.created`. If any role is `expired` or `degraded`, it shows a warning
toast:

> Free Models Expired — oracle uses a model that is no longer free. Run
> `oh-my-free-models free status --fix` ...

The hook never performs a network request and never blocks startup. Project
state is intentionally not checked at startup; use `free status --scope project`
for that.

## Building from source

The upstream repository uses git submodules for frontend skill assets. A source
snapshot may not have them. The fork adds two escape hatches:

```bash
bun install --ignore-scripts
OMO_SKIP_MATERIALIZE=1 OMO_BUILD_PROFILE=opencode bun run build
```

`OMO_SKIP_MATERIALIZE=1` skips the submodule materialization step, and the
`opencode` build profile builds only the plugin, CLI, and schemas:

```bash
bun build packages/omo-opencode/src/index.ts --outdir dist --target bun --format esm --external zod
bun build packages/omo-opencode/src/cli/index.ts --outdir dist/cli --target bun --format esm
```

Run the tests for the fork-specific code:

```bash
bun test packages/model-core/src/free-models
bun test packages/omo-opencode/src/cli/free-models
```

## Limitations

- Free availability is reported by models.dev, not probed against the provider.
  A model can be listed as free while temporarily rate-limited or unavailable.
- Scoring is heuristic. It is deterministic and explainable, but it is not a
  benchmark. Inspect `scan` and adjust the config if a role disagrees.
- Free tiers and model ids change without notice. The expiry flow is designed
  for exactly that.
- The upstream project's branding, docs, and assets are retained for attribution.
  See [NOTICE.md](../NOTICE.md).

## License

This fork is distributed under the upstream Sustainable Use License 1.0 (SUL-1.0).
It is free for personal and non-commercial use, and all upstream copyright and
license notices are retained. See [LICENSE.md](../LICENSE.md) and
[NOTICE.md](../NOTICE.md).
