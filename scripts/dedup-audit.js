#!/usr/bin/env node
// Audits open bug issues in OmneRealms/network for duplicates.
// Usage:
//   node scripts/dedup-audit.js                  # report only
//   node scripts/dedup-audit.js --fix --yes      # close dupes + add comments
//   node scripts/dedup-audit.js --all            # scan all open issues (report only)
//   node scripts/dedup-audit.js --fix --all --yes  # scan all + close dupes
//   node scripts/dedup-audit.js --threshold 0.4  # override similarity threshold

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Octokit } = require('@octokit/rest');

const GITHUB_OWNER = process.env.GITHUB_OWNER || 'OmneRealms';
const GITHUB_REPO = process.env.GITHUB_REPO || 'network';
const FIX = process.argv.includes('--fix');
const YES = process.argv.includes('--yes');
// --all scans every open issue regardless of label
const ALL = process.argv.includes('--all');

const thresholdArg = process.argv.indexOf('--threshold');
const DUPLICATE_THRESHOLD = thresholdArg !== -1
  ? parseFloat(process.argv[thresholdArg + 1])
  : parseFloat(process.env.DUPLICATE_THRESHOLD || '0.35');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const STOP_WORDS = new Set([
  // English
  'the','and','is','in','it','of','to','a','an','that','this','was','for',
  'on','are','with','as','at','be','by','from','or','but','not','have','had',
  'has','he','she','they','we','you','i','my','your','our','its','do','did',
  'does','can','could','would','should','will','just','about','when','how',
  'what','who','which','there','their','been','was','were','also','get','got',
  'into','more','after','before','so','if','up','out','me','him','her','them',
  'make','made','adds','added','use','used','using','work','works','need',
  // Skyblock/Minecraft — ubiquitous in every issue, carry no discriminating signal
  'island','spawn','player','players','server','minecraft','skyblock',
  'plugin','command','feature','issue','bug','improvement','discord',
  'block','blocks','item','items','chest','inventory','game','world',
]);

function extractKeywords(text) {
  return new Set(
    (text || '').toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))
  );
}

// Symmetric overlap: max of both directions so short issues aren't unfairly penalised
function overlapScore(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let matches = 0;
  for (const w of setA) if (setB.has(w)) matches++;
  return Math.max(matches / setA.size, matches / setB.size);
}

async function getAllBugIssues() {
  const issues = [];
  let page = 1;
  while (true) {
    const opts = {
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      state: 'open',
      per_page: 100,
      page,
    };
    if (!ALL) opts.labels = 'bug,discord-report';
    const { data } = await octokit.rest.issues.listForRepo(opts);
    if (!data.length) break;
    issues.push(...data.filter(i => !i.pull_request));
    if (data.length < 100) break;
    page++;
  }
  return issues;
}

// Group direct pairs only — no transitivity.
// Primary = lowest issue number in each group.
function buildClusters(issueMap, pairs) {
  // pairs: [[numA, numB, score], ...]
  const groups = new Map(); // primary number → { issue, dupes: [{issue, score}] }

  for (const [a, b, score] of pairs) {
    const primary = Math.min(a, b);
    const dupe = Math.max(a, b);
    if (!groups.has(primary)) groups.set(primary, { issue: issueMap.get(primary), dupes: [] });
    groups.get(primary).dupes.push({ issue: issueMap.get(dupe), score });
  }

  return [...groups.values()].sort((a, b) => a.issue.number - b.issue.number);
}

async function main() {
  console.log(`\n${GITHUB_OWNER}/${GITHUB_REPO} — Bug dedup audit`);
  console.log(`Threshold: ${DUPLICATE_THRESHOLD}  |  Scope: ${ALL ? 'all open issues' : 'bug+discord-report only'}  |  Mode: ${FIX ? 'FIX requested' : 'report only'}\n`);

  process.stdout.write('Fetching open bug issues... ');
  const issues = await getAllBugIssues();
  console.log(`${issues.length} found.\n`);

  if (issues.length < 2) {
    console.log('Nothing to compare.');
    return;
  }

  // Pre-compute keyword sets
  const kw = issues.map(i => ({
    issue: i,
    keywords: extractKeywords(`${i.title} ${i.body || ''}`),
  }));

  // Pairwise comparison — direct pairs only
  process.stdout.write('Comparing pairs... ');
  const dupePairs = []; // [numA, numB, score] where numA < numB

  for (let i = 0; i < kw.length; i++) {
    for (let j = i + 1; j < kw.length; j++) {
      const score = overlapScore(kw[i].keywords, kw[j].keywords);
      if (score >= DUPLICATE_THRESHOLD) {
        dupePairs.push([kw[i].issue.number, kw[j].issue.number, score]);
      }
    }
  }
  console.log(`${dupePairs.length} duplicate pair(s) found.\n`);

  const issueMap = new Map(issues.map(i => [i.number, i]));
  const clusters = buildClusters(issueMap, dupePairs);

  if (!clusters.length) {
    console.log('No duplicate groups — all issues look unique.');
    return;
  }

  console.log(`Found ${clusters.length} group(s) with likely duplicates:\n`);
  console.log('─'.repeat(60));

  for (const { issue: primary, dupes } of clusters) {
    console.log(`\nPRIMARY  #${primary.number}: ${primary.title}`);
    console.log(`         ${primary.html_url}`);

    for (const { issue: dupe, score } of dupes) {
      console.log(`  DUPE   #${dupe.number} (${Math.round(score * 100)}% overlap): ${dupe.title}`);
      console.log(`         ${dupe.html_url}`);
    }
  }

  console.log('\n' + '─'.repeat(60));

  if (!FIX) {
    console.log('\nDry run only. Review the pairs above before making changes.');
    console.log('To close the reported duplicates, rerun with --fix --yes.');
    console.log('Adjust sensitivity with --threshold 0.4 (higher = stricter).\n');
    return;
  }

  if (!YES) {
    console.error('\nRefusing to close issues without explicit confirmation.');
    console.error('Review the dry-run output, then rerun with --fix --yes.');
    if (ALL) console.error('Because --all is enabled, this confirmation is especially important.');
    process.exitCode = 2;
    return;
  }

  console.log(`\nConfirmed with --yes. Closing ${dupePairs.length} duplicate pair candidate(s)...\n`);

  for (const { issue: primary, dupes } of clusters) {
    for (const { issue: dupe, score } of dupes) {
      try {
        await octokit.rest.issues.createComment({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          issue_number: dupe.number,
          body: [
            `Closing as duplicate of #${primary.number}.`,
            '',
            `_Identified by automated dedup audit (${Math.round(score * 100)}% keyword overlap)._`,
          ].join('\n'),
        });
        await octokit.rest.issues.update({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          issue_number: dupe.number,
          state: 'closed',
          state_reason: 'not_planned',
        });
        console.log(`  → Closed #${dupe.number}`);
      } catch (err) {
        console.error(`  → Failed to close #${dupe.number}: ${err.message}`);
      }
    }
  }

  console.log('\nDone.\n');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
