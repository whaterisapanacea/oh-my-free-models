import type { WorkProfile } from "./types"

export const AGENT_WORK_PROFILES: readonly WorkProfile[] = [
	{
		id: "sisyphus",
		kind: "agent",
		label: "Sisyphus · orchestrator",
		description: "Plans, delegates, and keeps multi-step work moving. Needs strong coding, tool use, and enough context to hold the plan.",
		weights: { coding: 5, agentic: 4, reasoning: 3, context: 3, toolCall: 2, speed: 1, writing: 1 },
	},
	{
		id: "hephaestus",
		kind: "agent",
		label: "Hephaestus · deep implementer",
		description: "Deep implementation work with long tool-driven sessions. Priority on coding quality and reasoning.",
		weights: { coding: 5, agentic: 4, reasoning: 4, context: 3, toolCall: 2, speed: 0.5 },
	},
	{
		id: "prometheus",
		kind: "agent",
		label: "Prometheus · planner",
		description: "Turns goals into executable plans. Reasoning and context matter more than raw speed.",
		weights: { reasoning: 5, context: 4, coding: 3, writing: 2, agentic: 1 },
	},
	{
		id: "oracle",
		kind: "agent",
		label: "Oracle · architect / reviewer",
		description: "Architecture calls, trade-off analysis, and review. Prioritizes reasoning and long context.",
		weights: { reasoning: 5, context: 4, coding: 3, writing: 2 },
	},
	{
		id: "librarian",
		kind: "agent",
		label: "Librarian · researcher",
		description: "Reads docs and large codebases, then reports back. Long context, tool use, and throughput win.",
		weights: { context: 5, toolCall: 4, speed: 3, reasoning: 2, writing: 2, vision: 1 },
	},
	{
		id: "explore",
		kind: "agent",
		label: "Explore · fast search",
		description: "Quick codebase search and reconnaissance. Speed and context are the main signals.",
		weights: { speed: 5, context: 4, toolCall: 3, coding: 2, reasoning: 1 },
	},
	{
		id: "multimodal-looker",
		kind: "agent",
		label: "Multimodal Looker · vision",
		description: "Reads screenshots, diagrams, PDFs, and UI captures. Must accept image input.",
		weights: { vision: 5, video: 2, context: 3, toolCall: 2, reasoning: 1 },
		requiredInputModalities: ["image"],
	},
	{
		id: "metis",
		kind: "agent",
		label: "Metis · requirements analysis",
		description: "Clarifies requirements and finds gaps before implementation. Reasoning and writing.",
		weights: { reasoning: 5, writing: 3, context: 4, coding: 2 },
	},
	{
		id: "momus",
		kind: "agent",
		label: "Momus · critic",
		description: "Reviews plans and code for correctness. Strong reasoning with coding literacy.",
		weights: { reasoning: 5, coding: 3, context: 3, writing: 2 },
	},
	{
		id: "atlas",
		kind: "agent",
		label: "Atlas · agentic coder",
		description: "Runs long autonomous coding loops. The most tool- and coding-heavy profile.",
		weights: { coding: 5, agentic: 5, toolCall: 3, context: 3, speed: 2 },
	},
	{
		id: "sisyphus-junior",
		kind: "agent",
		label: "Sisyphus Junior · fast coder",
		description: "Well-scoped implementation tasks. Prefers fast coding models over the biggest reasoners.",
		weights: { coding: 4, speed: 3, agentic: 2, toolCall: 2, context: 2 },
	},
]

export const CATEGORY_WORK_PROFILES: readonly WorkProfile[] = [
	{
		id: "visual-engineering",
		kind: "category",
		label: "Visual Engineering · UI/UX",
		description: "Frontend and visual work. Needs image input plus solid coding.",
		weights: { vision: 5, coding: 4, agentic: 3, context: 2, speed: 1 },
		requiredInputModalities: ["image"],
	},
	{
		id: "ultrabrain",
		kind: "category",
		label: "Ultrabrain · hardest reasoning",
		description: "The hardest reasoning tasks. Depth over speed.",
		weights: { reasoning: 5, context: 4, coding: 3, writing: 2 },
	},
	{
		id: "deep",
		kind: "category",
		label: "Deep · long investigation",
		description: "Long-running investigation and research. Context is the dominant trait.",
		weights: { context: 5, reasoning: 4, coding: 3, toolCall: 2 },
	},
	{
		id: "artistry",
		kind: "category",
		label: "Artistry · creative writing",
		description: "Creative and editorial writing. Text quality over tool use.",
		weights: { writing: 5, reasoning: 2, context: 2, speed: 1 },
	},
	{
		id: "quick",
		kind: "category",
		label: "Quick · fast utility",
		description: "Small, fast utility jobs. Latency matters most.",
		weights: { speed: 4, lightweight: 4, toolCall: 1, coding: 1 },
	},
	{
		id: "unspecified-low",
		kind: "category",
		label: "Unspecified Low · light coding",
		description: "Low-stakes coding and edits. Balanced toward speed.",
		weights: { speed: 3, lightweight: 2, coding: 3, toolCall: 2, context: 1 },
	},
	{
		id: "unspecified-high",
		kind: "category",
		label: "Unspecified High · serious coding",
		description: "High-stakes coding and agentic work.",
		weights: { coding: 4, reasoning: 4, context: 3, agentic: 3 },
	},
	{
		id: "writing",
		kind: "category",
		label: "Writing · long-form text",
		description: "Long-form documentation and prose. Writing quality and context.",
		weights: { writing: 5, context: 3, reasoning: 2 },
	},
]

export const ALL_WORK_PROFILES: readonly WorkProfile[] = [
	...AGENT_WORK_PROFILES,
	...CATEGORY_WORK_PROFILES,
]

export function findWorkProfile(id: string): WorkProfile | undefined {
	return ALL_WORK_PROFILES.find((profile) => profile.id === id)
}
