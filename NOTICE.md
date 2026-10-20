# NOTICE

## This is a modified fork

**oh-my-free-models** is a modified, non-commercial fork of
[**oh-my-opencode / OmO**](https://github.com/code-yeongyu/oh-my-openagent),
version **5.1.40**, originally created by **YeonGyu-Kim** and the OmO
contributors.

The original project and this fork are distributed under the **Sustainable Use
License 1.0 (SUL-1.0)**. See [LICENSE.md](LICENSE.md). This fork is provided
free of charge and is not intended for commercial use. All original copyright,
license, and attribution notices are retained.

- Fork: <https://github.com/whaterisapanacea/oh-my-free-models>
- Upstream: <https://github.com/code-yeongyu/oh-my-openagent>

## What was changed in this fork

The fork adds a free-model layer on top of the upstream agent harness:

- New pure-TypeScript free-model core in
  `packages/model-core/src/free-models/`:
  - models.dev catalog normalization and zero-cost filtering;
  - capability traits (coding, reasoning, context, output, speed, lightweight,
    tool use, vision, video, audio, writing, agentic);
  - work profiles for 11 built-in agents and 8 built-in categories;
  - deterministic scoring, hard requirements, fallback chains, and an optional
    diversity penalty;
  - free-catalog diffing, assignment health checks, and official-provider hints.
- New CLI commands in `packages/omo-opencode/src/cli/free-models/`:
  - `free-models scan` — list current free models and the best work for each;
  - `free-models apply` — write model + fallback chains to `~/.omo/omo.jsonc`;
  - `free-models status` — detect expired free models, recommend replacements,
    or keep a model with an official provider API key.
- New startup warning in
  `packages/omo-opencode/src/hooks/auto-update-checker/hook/free-models-status.ts`
  that reads the cached catalog and warns when a role's free model expired.
- Fork branding in the root package, CLI program name, and startup messages.
- An `OMO_SKIP_MATERIALIZE=1` escape hatch and an `opencode` build profile so the
  plugin can be built without the upstream frontend skill submodules.
- Documentation in [docs/free-models.md](docs/free-models.md).

The upstream agent prompts, skills, tools, and orchestration logic are otherwise
retained. The fork does not claim authorship of them.

## Data source

Free-model availability is read from [models.dev](https://models.dev), provider
`opencode`. models.dev is an independent community catalog; this fork does not
control its data and does not send it API keys or user content.

## No warranty

This software is provided **as is**, without warranty of any kind. Free-model
availability, model ids, and provider pricing can change at any time. You are
responsible for complying with each provider's terms of service and for any API
keys you add through OpenCode.
