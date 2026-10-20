import {
	updateOmoConfig,
	type OmoConfigEdit,
	type UpdateOmoConfigResult,
} from "@oh-my-opencode/omo-config-core"

import type { StoredAssignment } from "./types"

const OPEN_CODE_BLOCK = "[opencode]"

export type AssignmentEditsOptions = {
	readonly assignments: Readonly<Record<string, StoredAssignment>>
}

/**
 * Build edits for the canonical `models` chain plus the legacy `model` /
 * `fallback_models` pair. The extra keys are what the runtime-fallback hook and
 * older installs read, so writing all three keeps every code path in sync.
 */
export function buildAssignmentEdits(options: AssignmentEditsOptions): OmoConfigEdit[] {
	const edits: OmoConfigEdit[] = []
	for (const [profileId, assignment] of Object.entries(options.assignments)) {
		const section = assignment.kind === "agent" ? "agents" : "categories"
		const chain = [...assignment.chain]
		if (chain.length === 0) continue
		const basePath = [OPEN_CODE_BLOCK, section, profileId] as const
		edits.push(
			{ path: [...basePath, "model"], value: chain[0] },
			{ path: [...basePath, "fallback_models"], value: chain.slice(1) },
			{ path: [...basePath, "models"], value: chain },
		)
	}
	return edits
}

export type WriteAssignmentsOptions = {
	readonly assignments: Readonly<Record<string, StoredAssignment>>
	readonly scope: "user" | "project"
	readonly projectDir?: string
	readonly enableRuntimeFallback?: boolean
}

export type WriteAssignmentsResult = UpdateOmoConfigResult & {
	readonly edits: readonly OmoConfigEdit[]
}

export function writeAssignmentsToOmoConfig(options: WriteAssignmentsOptions): WriteAssignmentsResult {
	const edits = buildAssignmentEdits({ assignments: options.assignments })
	if (options.enableRuntimeFallback === true) {
		// Plugin-only keys are read from the `[opencode]` block. A top-level
		// `runtime_fallback` is rejected by the omo config loader as an unknown key.
		edits.push({ path: [OPEN_CODE_BLOCK, "runtime_fallback"], value: true })
	}
	const result = updateOmoConfig({
		edits,
		scope: options.scope,
		...(options.scope === "project" ? { projectDir: options.projectDir } : {}),
	})
	return { ...result, edits }
}
