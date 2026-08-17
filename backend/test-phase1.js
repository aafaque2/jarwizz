const BASE = 'http://localhost:4000';

async function testCommand(text) {
  console.log(`\n>>> "${text}"`);
  try {
    const res = await fetch(`${BASE}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(120000),
    });
    const data = await res.json();
    if (data.error) {
      console.log(`  ERROR: ${data.error}`);
      return;
    }
    data.plan.steps.forEach((s, i) => {
      console.log(`  ${i + 1}. [${s.tier}] ${s.description}`);
    });
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
  }
}

(async () => {
  await testCommand('open chrome and search for cats');
  await testCommand('what is the weather today');
  await testCommand('read the current page');
  await testCommand('send an email to john saying hello');
  await testCommand('delete the file called notes.txt');
  await testCommand('navigate to github.com');
  await testCommand('create a folder called Projects');
  await testCommand('summarize this article');
  await testCommand('draft a reply to the last email');
  await testCommand('submit the job application form');
  process.exit(0);
})();
