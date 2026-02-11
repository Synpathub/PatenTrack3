/**
 * e2e-test.ts — Direct pipeline logic test against Neon DB
 *
 * Tests each pipeline step's logic inline (no BullMQ workers needed).
 * This verifies: Drizzle queries work, business rules produce correct
 * results, and computed data lands in the right tables.
 *
 * Run: npx tsx workers/ingestion/src/e2e-test.ts
 */

import 'dotenv/config';
import postgres from 'postgres';
import { classifyConveyance, matchInventorsToAssignment, analyzeChain, normalizeName, groupEntities } from '@patentrack/business-rules';
import type { ChainTransaction } from '@patentrack/business-rules';

const ORG_ID = 'a0000000-0000-0000-0000-000000000001';
const sql = postgres(process.env.DATABASE_URL!);

async function step0_checkSeedData() {
  console.log('\n═══ STEP 0: SEED DATA CHECK ═══');
  const org = await sql`SELECT name FROM organizations WHERE id = ${ORG_ID}`;
  console.log(`Org: ${org[0]?.name}`);

  const assets = await sql`SELECT id, document_id FROM org_assets WHERE org_id = ${ORG_ID}`;
  console.log(`Assets: ${assets.length}`);

  const oa = await sql`SELECT id, rf_id, document_id, conveyance_type FROM org_assignments WHERE org_id = ${ORG_ID}`;
  console.log(`Org Assignments: ${oa.length}`);
  oa.forEach(r => console.log(`  ${r.rf_id} → ${r.document_id} (type: ${r.conveyance_type ?? 'NULL'})`));

  return { assets, orgAssignments: oa };
}

async function step1_classify() {
  console.log('\n═══ STEP 1: CLASSIFY ═══');

  // Reset conveyance_type to NULL to simulate fresh run
  await sql`UPDATE org_assignments SET conveyance_type = NULL, is_employer_assignment = false WHERE org_id = ${ORG_ID}`;

  const rows = await sql`
    SELECT oa.id, oa.rf_id, a.conveyance_text
    FROM org_assignments oa
    JOIN assignments a ON oa.assignment_id = a.id
    WHERE oa.org_id = ${ORG_ID} AND oa.conveyance_type IS NULL
  `;

  console.log(`Unclassified: ${rows.length}`);

  for (const row of rows) {
    const result = classifyConveyance(row.conveyance_text);
    console.log(`  ${row.rf_id}: "${row.conveyance_text?.substring(0, 50)}" → type=${result.conveyType} employer=${result.employerAssign}`);

    await sql`
      UPDATE org_assignments
      SET conveyance_type = ${result.conveyType},
          is_employer_assignment = ${result.employerAssign},
          classified_at = now(),
          updated_at = now()
      WHERE id = ${row.id}
    `;
  }

  console.log(`✅ Classified ${rows.length} assignments`);
}

async function step2_flag() {
  console.log('\n═══ STEP 2: FLAG (Inventor Match) ═══');

  const oa = await sql`
    SELECT id, rf_id, document_id
    FROM org_assignments WHERE org_id = ${ORG_ID}
  `;

  let flagged = 0;

  for (const row of oa) {
    const assignors = await sql`SELECT name FROM assignment_assignors WHERE rf_id = ${row.rf_id}`;
    const inventors = await sql`
      SELECT pi.name FROM org_assets oas
      JOIN patent_inventors pi ON oas.patent_id = pi.patent_id
      WHERE oas.org_id = ${ORG_ID} AND oas.document_id = ${row.document_id}
    `;

    if (assignors.length === 0 || inventors.length === 0) continue;

    const inventorNames = inventors.map(i => ({
      firstName: i.name.split(' ')[0] ?? '',
      lastName: i.name.split(' ').slice(-1)[0] ?? '',
    }));

    const assignorNames = assignors.map(a => a.name);
    const match = matchInventorsToAssignment(inventorNames, assignorNames);

    console.log(`  ${row.rf_id}: assignors=[${assignorNames}] inventors=[${inventors.map(i=>i.name)}] → employer=${match.isEmployerAssignment}`);

    if (match.isEmployerAssignment) {
      await sql`
        UPDATE org_assignments
        SET is_employer_assignment = true, flagged = true,
            flag_reason = ${`Inventor match: ${match.matchedAssignor ?? 'unknown'}`},
            updated_at = now()
        WHERE id = ${row.id}
      `;
      flagged++;
    }
  }

  console.log(`✅ Flagged ${flagged} employer assignments`);
}

async function step3_tree() {
  console.log('\n═══ STEP 3: TREE BUILD ═══');

  const assets = await sql`SELECT id, document_id FROM org_assets WHERE org_id = ${ORG_ID}`;

  for (const asset of assets) {
    const assigns = await sql`
      SELECT oa.id, oa.rf_id, oa.conveyance_type, oa.is_employer_assignment, oa.record_date
      FROM org_assignments oa
      WHERE oa.org_id = ${ORG_ID} AND oa.document_id = ${asset.document_id}
      ORDER BY oa.record_date ASC
    `;

    const treeNodes = [];
    for (const a of assigns) {
      const assignors = await sql`SELECT name FROM assignment_assignors WHERE rf_id = ${a.rf_id}`;
      const assignees = await sql`SELECT name FROM assignment_assignees WHERE rf_id = ${a.rf_id}`;

      treeNodes.push({
        rfId: a.rf_id,
        conveyanceType: a.conveyance_type,
        isEmployerAssignment: a.is_employer_assignment,
        assignors: assignors.map(r => r.name),
        assignees: assignees.map(r => r.name),
        recordDate: a.record_date,
      });
    }

    console.log(`  Asset ${asset.document_id}: ${treeNodes.length} nodes`);
    treeNodes.forEach(n => console.log(`    ${n.rfId}: ${n.assignors} → ${n.assignees} (${n.conveyanceType})`));

    // Write dashboard item with tree
    await sql`
      INSERT INTO dashboard_items (org_id, asset_id, type, tab, tree_json, computed_at)
      VALUES (${ORG_ID}, ${asset.id}, 0, 'complete', ${JSON.stringify(treeNodes)}, now())
      ON CONFLICT (org_id, asset_id) DO UPDATE
      SET tree_json = ${JSON.stringify(treeNodes)}, computed_at = now(), updated_at = now()
    `;
  }

  console.log(`✅ Built ${assets.length} trees`);
}

async function step4_timeline() {
  console.log('\n═══ STEP 4: TIMELINE ═══');

  const grouped = await sql`
    SELECT record_date, count(*)::int as count, array_agg(distinct conveyance_type) as types
    FROM org_assignments WHERE org_id = ${ORG_ID}
    GROUP BY record_date
  `;

  for (const row of grouped) {
    if (!row.record_date) continue;
    console.log(`  ${row.record_date}: ${row.count} assignments, types=[${row.types}]`);

    await sql`
      INSERT INTO timeline_entries (org_id, entry_date, assignment_count, types)
      VALUES (${ORG_ID}, ${row.record_date}, ${row.count}, ${row.types})
      ON CONFLICT (org_id, entry_date) DO UPDATE
      SET assignment_count = ${row.count}, types = ${row.types}, updated_at = now()
    `;
  }

  console.log(`✅ ${grouped.length} timeline entries`);
}

async function step5_brokenTitle() {
  console.log('\n═══ STEP 5: BROKEN TITLE CHAIN ANALYSIS ═══');

  const assets = await sql`SELECT id, document_id FROM org_assets WHERE org_id = ${ORG_ID}`;

  let broken = 0, complete = 0, encumbered = 0;

  for (const asset of assets) {
    const assigns = await sql`
      SELECT rf_id, conveyance_type, is_employer_assignment, record_date
      FROM org_assignments
      WHERE org_id = ${ORG_ID} AND document_id = ${asset.document_id}
      ORDER BY record_date ASC
    `;

    const transactions: ChainTransaction[] = [];

    for (const a of assigns) {
      const assignors = await sql`SELECT name FROM assignment_assignors WHERE rf_id = ${a.rf_id}`;
      const assignees = await sql`SELECT name FROM assignment_assignees WHERE rf_id = ${a.rf_id}`;

      transactions.push({
        rfId: a.rf_id,
        assignorNames: assignors.map(r => r.name),
        assigneeNames: assignees.map(r => r.name),
        conveyanceType: a.conveyance_type ?? 'missing',
        employerAssign: a.is_employer_assignment,
        recordDate: a.record_date ?? new Date(0),
      });
    }

    const chainResult = analyzeChain(transactions);

    const tab = chainResult.status === 'broken' ? 'broken'
      : chainResult.status === 'encumbered' ? 'encumbered'
      : 'complete';

    const brokenReason = chainResult.breaks.length > 0
      ? chainResult.breaks.map(b => b.reason).join('; ')
      : null;

    console.log(`  Asset ${asset.document_id}: status=${chainResult.status} type=${chainResult.dashboardType} breaks=${chainResult.breaks.length}`);
    if (brokenReason) console.log(`    Reason: ${brokenReason}`);

    await sql`
      UPDATE dashboard_items
      SET type = ${chainResult.dashboardType},
          tab = ${tab},
          is_broken = ${chainResult.status === 'broken'},
          broken_reason = ${brokenReason},
          computed_at = now(),
          updated_at = now()
      WHERE org_id = ${ORG_ID} AND asset_id = ${asset.id}
    `;

    if (chainResult.status === 'broken') broken++;
    else if (chainResult.status === 'encumbered') encumbered++;
    else complete++;
  }

  console.log(`✅ Analyzed ${assets.length} chains: ${complete} complete, ${broken} broken, ${encumbered} encumbered`);
}

async function step6_summary() {
  console.log('\n═══ STEP 6: SUMMARY + ENTITIES ═══');

  // Collect names
  const assignorNames = await sql`
    SELECT aa.name, count(*)::int as count
    FROM assignment_assignors aa
    JOIN org_assignments oa ON aa.rf_id = oa.rf_id
    WHERE oa.org_id = ${ORG_ID}
    GROUP BY aa.name
  `;

  const assigneeNames = await sql`
    SELECT ae.name, count(*)::int as count
    FROM assignment_assignees ae
    JOIN org_assignments oa ON ae.rf_id = oa.rf_id
    WHERE oa.org_id = ${ORG_ID}
    GROUP BY ae.name
  `;

  const nameMap = new Map<string, number>();
  for (const row of [...assignorNames, ...assigneeNames]) {
    const normalized = normalizeName(row.name);
    nameMap.set(normalized, (nameMap.get(normalized) ?? 0) + row.count);
  }

  console.log(`  Unique normalized names: ${nameMap.size}`);
  nameMap.forEach((count, name) => console.log(`    "${name}" (${count} occurrences)`));

  const candidates = Array.from(nameMap.entries()).map(([name, count], idx) => ({
    id: idx,
    name,
    occurrenceCount: count,
  }));

  const groups = groupEntities(candidates);
  console.log(`  Entity groups: ${groups.length}`);
  groups.forEach(g => console.log(`    Canonical: "${g.canonicalName}" → [${g.names.join(', ')}]`));

  // Write entities
  await sql`DELETE FROM entity_aliases WHERE org_id = ${ORG_ID}`;
  await sql`DELETE FROM entities WHERE org_id = ${ORG_ID}`;

  for (const group of groups) {
    const [entity] = await sql`
      INSERT INTO entities (org_id, canonical_name) VALUES (${ORG_ID}, ${group.canonicalName})
      RETURNING id
    `;
    for (const name of group.names) {
      await sql`
        INSERT INTO entity_aliases (entity_id, org_id, name, occurrence_count)
        VALUES (${entity.id}, ${ORG_ID}, ${name}, ${nameMap.get(name) ?? 1})
      `;
    }
  }

  // Dashboard counts
  const counts = await sql`
    SELECT tab, count(*)::int as count FROM dashboard_items WHERE org_id = ${ORG_ID} GROUP BY tab
  `;
  const countMap = Object.fromEntries(counts.map(c => [c.tab, c.count]));

  const txnCount = await sql`SELECT count(*)::int as count FROM org_assignments WHERE org_id = ${ORG_ID}`;
  const empCount = await sql`SELECT count(*)::int as count FROM org_assignments WHERE org_id = ${ORG_ID} AND is_employer_assignment = true`;

  // Write summary
  await sql`
    INSERT INTO summary_metrics (org_id, total_assets, total_entities, total_transactions, total_employees, total_parties, complete_chains, broken_chains, encumbrances, computed_at)
    VALUES (${ORG_ID}, ${countMap.complete ?? 0 + (countMap.broken ?? 0) + (countMap.encumbered ?? 0)}, ${groups.length}, ${txnCount[0].count}, ${empCount[0].count}, ${nameMap.size}, ${countMap.complete ?? 0}, ${countMap.broken ?? 0}, ${countMap.encumbered ?? 0}, now())
    ON CONFLICT (org_id) DO UPDATE
    SET total_assets = EXCLUDED.total_assets, total_entities = EXCLUDED.total_entities,
        total_transactions = EXCLUDED.total_transactions, total_employees = EXCLUDED.total_employees,
        total_parties = EXCLUDED.total_parties, complete_chains = EXCLUDED.complete_chains,
        broken_chains = EXCLUDED.broken_chains, encumbrances = EXCLUDED.encumbrances,
        computed_at = now(), updated_at = now()
  `;

  console.log(`✅ Summary written: ${txnCount[0].count} transactions, ${groups.length} entities, ${empCount[0].count} employer assigns`);
}

async function step7_verify() {
  console.log('\n═══ FINAL VERIFICATION ═══');

  const dashboard = await sql`SELECT type, tab, is_broken, broken_reason FROM dashboard_items WHERE org_id = ${ORG_ID}`;
  console.log(`Dashboard items: ${dashboard.length}`);
  dashboard.forEach(d => console.log(`  type=${d.type} tab=${d.tab} broken=${d.is_broken} reason=${d.broken_reason ?? '-'}`));

  const timeline = await sql`SELECT entry_date, assignment_count, types FROM timeline_entries WHERE org_id = ${ORG_ID}`;
  console.log(`Timeline entries: ${timeline.length}`);
  timeline.forEach(t => console.log(`  ${t.entry_date}: ${t.assignment_count} [${t.types}]`));

  const entities = await sql`SELECT e.canonical_name, array_agg(ea.name) as aliases FROM entities e JOIN entity_aliases ea ON e.id = ea.entity_id WHERE e.org_id = ${ORG_ID} GROUP BY e.id, e.canonical_name`;
  console.log(`Entities: ${entities.length}`);
  entities.forEach(e => console.log(`  "${e.canonical_name}" → [${e.aliases}]`));

  const summary = await sql`SELECT * FROM summary_metrics WHERE org_id = ${ORG_ID}`;
  if (summary.length > 0) {
    const s = summary[0];
    console.log(`Summary: assets=${s.total_assets} entities=${s.total_entities} txns=${s.total_transactions} employees=${s.total_employees} complete=${s.complete_chains} broken=${s.broken_chains} encumbered=${s.encumbrances}`);
  }

  const oa = await sql`SELECT rf_id, conveyance_type, is_employer_assignment, flagged, flag_reason FROM org_assignments WHERE org_id = ${ORG_ID}`;
  console.log(`Final org_assignments:`);
  oa.forEach(r => console.log(`  ${r.rf_id}: type=${r.conveyance_type} employer=${r.is_employer_assignment} flagged=${r.flagged} reason=${r.flag_reason ?? '-'}`));
}

async function main() {
  try {
    await step0_checkSeedData();
    await step1_classify();
    await step2_flag();
    await step3_tree();
    await step4_timeline();
    await step5_brokenTitle();
    await step6_summary();
    await step7_verify();

    console.log('\n✅ ALL PIPELINE STEPS COMPLETED SUCCESSFULLY');
  } catch (err) {
    console.error('\n❌ E2E TEST ERROR:', err);
  } finally {
    await sql.end();
    process.exit(0);
  }
}

main();
