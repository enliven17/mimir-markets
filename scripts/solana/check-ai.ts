import { callLLMWithMeta, extractJson, isSettlementModel } from "../../lib/llm";

async function main() {
  for (const role of ["web", "oracle"] as const) {
    const result = await callLLMWithMeta('Return only this JSON object: {"ok":true}', {
      role, settlement: role === "oracle", mainnet: false, jsonOnly: true, maxTokens: 512, temperature: 0,
    });
    const body = extractJson(result.text);
    if (!body || JSON.parse(body).ok !== true || role === "oracle" && !isSettlementModel(result.model)) throw new Error(`${role} model check failed`);
    console.log(JSON.stringify({ role, provider: result.provider, model: result.model, ok: true }));
  }
}
main().catch(e => { console.error(e instanceof Error ? e.message : "AI check failed"); process.exitCode = 1; });
