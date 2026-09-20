import { chatAgent } from './lib/agent-core.js';

async function test() {
  console.log('Testing full chatAgent loop with real tool execution...');
  const result = await chatAgent({
    message: 'What is the primary bottleneck in scenario 1 of model2, and what are the utilization metrics?',
    context: { facility: 'Model 2', scenario: '1' }
  });

  console.log('\n=================== AGENT ANSWER ===================');
  console.log(result.answer);
  console.log('\n=================== EXECUTED TOOLS ===================');
  console.log(JSON.stringify(result.executed_tools.map(t => ({ tool: t.tool, arguments: t.arguments, outputPreview: JSON.stringify(t.output).slice(0, 150) })), null, 2));
  console.log('\n=================== RENDER BLOCKS ===================');
  console.log(JSON.stringify(result.render_blocks, null, 2));
}

test().catch(err => console.error('TEST ERROR:', err));
