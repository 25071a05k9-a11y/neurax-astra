import { AgySession } from './lib/agy-provider.js';
import { toolCatalogForPrompt } from './lib/astra-tools.js';

async function test() {
  const session = new AgySession({ model: 'gemini-3.8-flash-high' });
  const prompt = `SYSTEM:
You are ASTRA Industrial Manufacturing Assistant.
CRITICAL INSTRUCTION ON TOOLS: Do NOT call any internal CLI tools such as run_command or read_file.
You must ONLY request tools from the AVAILABLE TOOLS list below by listing them in your "tool_calls" JSON array.
Return a SINGLE valid JSON object with keys "answer", "tool_calls", and "render_blocks".

AVAILABLE TOOLS:
${JSON.stringify(toolCatalogForPrompt(), null, 2)}

USER:
What is the primary bottleneck and machine utilizations in scenario 1 of model2?`;

  try {
    const res = await session.send(prompt);
    console.log('RESULT:\n', res);
  } finally {
    await session.close();
  }
}

test().catch(err => console.error('ERROR:', err));
