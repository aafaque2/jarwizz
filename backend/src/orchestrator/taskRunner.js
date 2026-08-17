let stopFlag = false;

function requestStop() {
  stopFlag = true;
}

function resetStop() {
  stopFlag = false;
}

function isStopped() {
  return stopFlag;
}

async function runPlan(plan, broadcast) {
  resetStop();

  const results = [];

  for (let i = 0; i < plan.steps.length; i++) {
    if (isStopped()) {
      const skipResult = { ...plan.steps[i], status: 'skipped', reason: 'stopped' };
      results.push(skipResult);
      if (broadcast) broadcast('step_skipped', skipResult);
      console.log(`  [STOPPED] Skipping step ${i + 1}: ${plan.steps[i].description}`);
      continue;
    }

    const step = plan.steps[i];
    const stepResult = {
      step_index: i,
      ...step,
      status: 'completed',
      timestamp: new Date().toISOString(),
    };

    console.log(`  [${step.tier.toUpperCase()}] Step ${i + 1}/${plan.steps.length}: ${step.description}`);
    results.push(stepResult);

    if (broadcast) broadcast('step_completed', stepResult);
  }

  return results;
}

module.exports = { requestStop, resetStop, isStopped, runPlan };
