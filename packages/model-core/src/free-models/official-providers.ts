export type OfficialProviderHint = {
	/** models.dev provider id for the official API. */
	readonly provider: string
	readonly label: string
	/** Environment variable commonly used by that provider. */
	readonly apiKeyEnv?: string
}

const HINTS: ReadonlyArray<{ readonly pattern: RegExp; readonly hint: OfficialProviderHint }> = [
	{ pattern: /deepseek/i, hint: { provider: "deepseek", label: "DeepSeek", apiKeyEnv: "DEEPSEEK_API_KEY" } },
	{ pattern: /kimi|moonshot/i, hint: { provider: "moonshotai", label: "Moonshot AI (Kimi)", apiKeyEnv: "MOONSHOT_API_KEY" } },
	{ pattern: /glm|chatglm|zhipu/i, hint: { provider: "zai", label: "Z.ai / Zhipu", apiKeyEnv: "ZAI_API_KEY" } },
	{ pattern: /minimax/i, hint: { provider: "minimax", label: "MiniMax", apiKeyEnv: "MINIMAX_API_KEY" } },
	{ pattern: /qwen|tongyi/i, hint: { provider: "alibaba", label: "Alibaba Qwen", apiKeyEnv: "DASHSCOPE_API_KEY" } },
	{ pattern: /mimo/i, hint: { provider: "xiaomi", label: "Xiaomi MiMo", apiKeyEnv: "XIAOMI_API_KEY" } },
	{ pattern: /nemotron/i, hint: { provider: "nvidia", label: "NVIDIA NIM", apiKeyEnv: "NVIDIA_API_KEY" } },
	{ pattern: /grok/i, hint: { provider: "xai", label: "xAI", apiKeyEnv: "XAI_API_KEY" } },
	{ pattern: /longcat/i, hint: { provider: "longcat", label: "LongCat", apiKeyEnv: "LONGCAT_API_KEY" } },
	{ pattern: /step/i, hint: { provider: "stepfun", label: "StepFun", apiKeyEnv: "STEPFUN_API_KEY" } },
	{ pattern: /claude|opus|sonnet|haiku/i, hint: { provider: "anthropic", label: "Anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" } },
	{ pattern: /gpt|openai|codex/i, hint: { provider: "openai", label: "OpenAI", apiKeyEnv: "OPENAI_API_KEY" } },
	{ pattern: /gemini|gemma/i, hint: { provider: "google", label: "Google AI", apiKeyEnv: "GEMINI_API_KEY" } },
]

/**
 * Best-effort mapping from an OpenCode free model id to the official provider
 * that sells the same family. Used only to print guidance when a free model
 * expires; the CLI never stores or prints API keys.
 */
export function findOfficialProviderHint(modelId: string): OfficialProviderHint | undefined {
	return HINTS.find((entry) => entry.pattern.test(modelId))?.hint
}
