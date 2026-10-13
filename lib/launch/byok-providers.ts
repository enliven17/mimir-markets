/** Mimir Launch: the providers an owner can bring a key for, and the model used when none is chosen. Isomorphic. */
export const BYOK_PROVIDERS = {
  openai: { label: "OpenAI", model: "gpt-5-mini" },
  anthropic: { label: "Anthropic", model: "claude-haiku-5-5" },
  gemini: { label: "Gemini", model: "gemini-3.5-flash" },
  groq: { label: "Groq", model: "openai/gpt-oss-20b" },
  openrouter: { label: "OpenRouter", model: "openai/gpt-oss-20b" },
} as const;
export type ByokProvider = keyof typeof BYOK_PROVIDERS;
