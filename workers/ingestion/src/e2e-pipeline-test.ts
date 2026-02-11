/**
 * e2e-pipeline-test.ts
 * 
 * Starts all workers, creates a pipeline_run, enqueues classify for Acme Corp,
 * and monitors until the pipeline completes or fails.
 * 
 * Run: npx tsx workers/ingestion/src/e2e-pipeline-test.ts
 */

import 'dotenv/config';
import IORedis from 'ioredis';
import postgres from 'postgres';
import { classifyQueue } from './queues';
import { redis } from './config';

const ORG_ID = 'a0000000-0000-0000-0000-000000000001';

const sql = postgres(process.env.DATABASE_URL!);

async function checkSeedData() {
  console.log('\n=== CHECKING SEED DATA ===');
  
  const org = await sql`SELECT id, name FROM organizations WHERE id = ${ORG_ID}`;
  console.log('Organization:', org[0]?.name ?? 'NOT FOUND');

  const patents = await sql`SELECT id, grant_number, title FROM patents`;
  console.log(`Patents: ${patents.length}`);
  patents.forEach(p => console.log(`  - ${p.grant_number}: ${p.title}`));

  const assignments = await sql`SELECT id, rf_id, conveyance_text FROM assignments`;
  console.log(`Assignments: ${assignments.length}`);
  assignments.forEach(a => console.log(`  - ${a.rf_id}: ${a.conveyance_text?.substring(0, 60)}`));

  const orgAssets = await sql`SELECT id, document_id FROM org_assets WHERE org_id = ${ORG_ID}`;
  console.log(`Org Assets: ${orgAssets.length}`);
  orgAssets.forEach(a => console.log(`  - ${a.document_id}`));

  const orgAssignments = await sql`SELECT id, rf_id, document_id, conveyance_type FROM org_assignments WHERE org_id = ${ORG_ID}`;
  console.log(`Org Assignments: ${orgAssignments.length}`);
  orgAssignments.forEach(a => console.log(`  - ${a.rf_id} → ${a.document_id} (type: ${a.conveyance_type ?? 'null'})`));

  const inventors = await sql`SELECT pi.name, p.grant_number FROM patent_inventors pi JOIN patents p ON pi.patent_id = p.id`;
  console.log(`Inventors: ${inventors.length}`);
  inventors.forEach(i => console.log(`  - ${i.name} (${i.grant_number})`));

  const assignors = await sql`SELECT name, rf_id FROM assignment_assignors`;
  console.log(`Assignors: ${assignors.length}`);
  assignors.forEach(a => console.log(`  - ${a.name} (${a.rf_id})`));

  const assignees = await sql`SELECT name, rf_id FROM assignment_assignees`;
  console.log(`Assignees: ${assignees.length}`);
  assignees.forEach(a => console.log(`  - ${a.name} (${a.rf_id})`));

  return { orgAssignments: orgAssignments.length, orgAssets: orgAssets.length };
}

async function createPipelineRun(): Promise<string> {
  const [run] = await sql`
    INSERT INTO pipeline_runs (org_id, trigger, status, started_at)
    VALUES (${ORG_ID}, 'e2e-test', 'waiting', now())
    RETURNING id
  `;
  console.log(`\nPipeline run created: ${run.id}`);
  return run.id;
}

async function monitorPipeline(pipelineRunId: string, timeoutMs: number = 30000) {
  console.log('\n=== MONITORING PIPELINE ===');
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const [run] = await sql`
      SELECT status, current_step, steps_completed, error_message, completed_at
      FROM pipeline_runs WHERE id = ${pipelineRunId}
    `;

    const step = run.current_step ?? 'waiting';
    const steps = run.steps_completed ?? [];
    console.log(`  [${((Date.now() - start) / 1000).toFixed(1)}s] status=${run.status} step=${step} completed=[${steps.join(',')}]`);

    if (run.status === 'completed') {
      console.log(`\n✅ PIPELINE COMPLETED in ${((Date.now() - start) / 1000).toFixed(1)}s`);
      return true;
    }

    if (run.status === 'failed') {
      console.log(`\n❌ PIPELINE FAILED: ${run.error_message}`);
      return false;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n⏰ PIPELINE TIMED OUT');
  return false;
}

async function checkResults() {
  console.log('\n=== PIPELINE RESULTS ===');

  const dashboardItems = await sql`SELECT type, tab, is_broken, broken_reason FROM dashboard_items WHERE org_id = ${ORG_ID}`;
  console.log(`Dashboard Items: ${dashboardItems.length}`);
  dashboardItems.forEach(d => console.log(`  - type=${d.type} tab=${d.tab} broken=${d.is_broken} reason=${d.broken_reason ?? 'none'}`));

  const timeline = await sql`SELECT entry_date, assignment_count, types FROM timeline_entries WHERE org_id = ${ORG_ID}`;
  console.log(`Timeline Entries: ${timeline.length}`);
  timeline.forEach(t => console.log(`  - ${t.entry_date} count=${t.assignment_count} types=[${t.types}]`));

  const entities = await sql`SELECT canonical_name FROM entities WHERE org_id = ${ORG_ID}`;
  console.log(`Entities: ${entities.length}`);
  entities.forEach(e => console.log(`  - ${e.canonical_name}`));

  const summary = await sql`SELECT total_assets, total_entities, total_transactions, complete_chains, broken_chains, encumbrances FROM summary_metrics WHERE org_id = ${ORG_ID}`;
  if (summary.length > 0) {
    const s = summary[0];
    console.log(`Summary: assets=${s.total_assets} entities=${s.total_entities} txns=${s.total_transactions} complete=${s.complete_chains} broken=${s.broken_chains} encumbered=${s.encumbrances}`);
  }

  const freshness = await sql`SELECT source, last_success_at, last_record_count FROM data_freshness`;
  console.log(`Data Freshness: ${freshness.length}`);
  freshness.forEach(f => console.log(`  - ${f.source}: last_success=${f.last_success_at} records=${f.last_record_count}`));
}

async function main() {
  try {
    // Step 1: Check seed data
    const { orgAssignments, orgAssets } = await checkSeedData();

    if (orgAssignments === 0) {
      console.log('\n⚠️  No org_assignments found. The classify worker needs unclassified org_assignments to process.');
      console.log('The seed data may not have linked assignments to the org. Check if org_assignments has rows.');
      await sql.end();
      redis.disconnect();
      process.exit(1);
    }

    if (orgAssets === 0) {
      console.log('\n⚠️  No org_assets found. The tree/broken-title workers need org_assets to process.');
      await sql.end();
      redis.disconnect();
      process.exit(1);
    }

    // Step 2: Start workers (import triggers worker creation)
    console.log('\n=== STARTING WORKERS ===');
    await import('./processing/classify.worker');
    await import('./processing/flag.worker');
    await import('./processing/tree.worker');
    await import('./processing/timeline.worker');
    await import('./processing/broken-title.worker');
    await import('./processing/dashboard.worker');
    await import('./processing/summary.worker');
    await import('./processing/generate-json.worker');
    console.log('All 8 workers started');

    // Step 3: Create pipeline run and enqueue
    const pipelineRunId = await createPipelineRun();

    console.log('\n=== ENQUEUING CLASSIFY JOB ===');
    await classifyQueue.add('classify', {
      organizationId: ORG_ID,
      pipelineRunId,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });
    console.log('Classify job enqueued');

    // Step 4: Monitor
    const success = await monitorPipeline(pipelineRunId);

    // Step 5: Check results
    await checkResults();

    // Cleanup
    await sql.end();
    redis.disconnect();
    process.exit(success ? 0 : 1);

  } catch (err) {
    console.error('\n❌ E2E TEST ERROR:', err);
    await sql.end();
    redis.disconnect();
    process.exit(1);
  }
}

main();
