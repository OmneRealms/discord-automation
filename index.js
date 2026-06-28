require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');

const GITHUB_OWNER = 'OmneRealms';
const GITHUB_REPO = 'network';
const DATA_FILE = path.join(__dirname, 'data', 'processed.json');

const BUGS_CHANNEL = process.env.BUGS_CHANNEL_ID;
const SUGGESTIONS_CHANNEL = process.env.SUGGESTIONS_CHANNEL_ID;
const REACTION_THRESHOLD = parseInt(process.env.REACTION_THRESHOLD || '5', 10);
// Fraction of keywords that must overlap to count as a duplicate (0–1)
const DUPLICATE_THRESHOLD = parseFloat(process.env.DUPLICATE_THRESHOLD || '0.35');

const STOP_WORDS = new Set([
  'the','and','is','in','it','of','to','a','an','that','this','was','for',
  'on','are','with','as','at','be','by','from','or','but','not','have','had',
  'has','he','she','they','we','you','i','my','your','our','its','do','did',
  'does','can','could','would','should','will','just','about','when','how',
  'what','who','which','there','their','been','was','were','also','get','got',
  'into','more','after','before','so','if','up','out','me','him','her','them',
]);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// --- Persistence ---

let processed = { bugs: new Set(), suggestions: new Set() };

function loadProcessed() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      processed.bugs = new Set(raw.bugs || []);
      processed.suggestions = new Set(raw.suggestions || []);
      console.log(`Loaded ${processed.bugs.size} bugs, ${processed.suggestions.size} suggestions from disk.`);
    }
  } catch (err) {
    console.error('Failed to load processed.json:', err.message);
  }
}

function saveProcessed() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    bugs: [...processed.bugs],
    suggestions: [...processed.suggestions],
  }, null, 2));
}

// --- Duplicate detection ---

function extractKeywords(text) {
  return new Set(
    text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))
  );
}

function overlapScore(setA, setB) {
  if (setA.size === 0) return 0;
  let matches = 0;
  for (const w of setA) if (setB.has(w)) matches++;
  // Jaccard-like: intersection / size of the query set
  return matches / setA.size;
}

async function findSimilarIssue(content) {
  const keywords = extractKeywords(content);
  if (keywords.size === 0) return null;

  // Use the top 6 keywords as the GitHub search query
  const queryTerms = [...keywords].slice(0, 6).join(' ');
  const q = `repo:${GITHUB_OWNER}/${GITHUB_REPO} is:issue is:open label:bug ${queryTerms}`;

  let items;
  try {
    const { data } = await octokit.rest.search.issuesAndPullRequests({ q, per_page: 10 });
    items = data.items;
  } catch (err) {
    console.warn('[dedup] Search failed:', err.message);
    return null;
  }

  if (!items.length) return null;

  let best = null;
  let bestScore = 0;

  for (const issue of items) {
    const issueKeywords = extractKeywords(`${issue.title} ${issue.body || ''}`);
    const score = overlapScore(keywords, issueKeywords);
    if (score > bestScore) {
      bestScore = score;
      best = issue;
    }
  }

  if (bestScore >= DUPLICATE_THRESHOLD) {
    console.log(`[dedup] Match found: #${best.number} (score ${bestScore.toFixed(2)})`);
    return best;
  }
  return null;
}

async function tallyOnIssue(issue, message) {
  // Count existing tally comments to get total report number
  const { data: comments } = await octokit.rest.issues.listComments({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    issue_number: issue.number,
    per_page: 100,
  });
  const tallyCount = comments.filter(c => c.body?.startsWith('📌 **Duplicate report')).length;
  const totalReports = tallyCount + 2; // original + previous tallies + this one

  await octokit.rest.issues.createComment({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    issue_number: issue.number,
    body: [
      `📌 **Duplicate report #${totalReports}**`,
      '',
      `**Reporter:** ${message.author.tag}`,
      `**Message:** ${message.content}`,
      `**Discord link:** ${messageLink(message)}`,
    ].join('\n'),
  });

  return issue.html_url;
}

// --- GitHub helpers ---

async function ensureLabels() {
  const required = [
    { name: 'bug', color: 'd73a4a', description: 'Something isn\'t working' },
    { name: 'discord-report', color: '5865F2', description: 'Reported via Discord' },
    { name: 'suggestion', color: 'a2eeef', description: 'New feature or improvement' },
    { name: 'pending-review', color: 'e4e669', description: 'Awaiting owner review' },
    { name: 'auto-implement', color: '0075ca', description: 'Claude should implement this automatically' },
  ];
  for (const label of required) {
    try {
      await octokit.rest.issues.createLabel({ owner: GITHUB_OWNER, repo: GITHUB_REPO, ...label });
    } catch (err) {
      if (err.status !== 422) console.warn(`Label "${label.name}":`, err.message);
    }
  }
}

async function createIssue(title, body, labels) {
  const { data } = await octokit.rest.issues.create({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    title: title.slice(0, 256),
    body,
    labels,
  });
  return data.html_url;
}

function messageLink(message) {
  return `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

// --- Events ---

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  loadProcessed();
  await ensureLabels();
  console.log(`Ready. Watching #bugs and #suggestions. Duplicate threshold: ${DUPLICATE_THRESHOLD}`);
});

// #bugs: deduplicate against open issues, tally if match found
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== BUGS_CHANNEL) return;
  if (processed.bugs.has(message.id)) return;

  const content = message.content.trim();
  if (!content) return;

  try {
    const existing = await findSimilarIssue(content);

    if (existing) {
      const url = await tallyOnIssue(existing, message);
      processed.bugs.add(message.id);
      saveProcessed();
      await message.react('🔁').catch(() => {});
      console.log(`[bug] Tallied on existing issue #${existing.number}: ${url}`);
    } else {
      const title = content.length > 100 ? content.slice(0, 97) + '...' : content;
      const body = [
        `**Reporter:** ${message.author.tag}`,
        '',
        '**Bug description:**',
        content,
        '',
        `**Discord message:** ${messageLink(message)}`,
      ].join('\n');

      const url = await createIssue(title, body, ['bug', 'discord-report']);
      processed.bugs.add(message.id);
      saveProcessed();
      await message.react('✅').catch(() => {});
      console.log(`[bug] New issue created: ${url}`);
    }
  } catch (err) {
    console.error('[bug] Failed:', err.message);
  }
});

// #suggestions: create issue when ✅ reaction reaches threshold
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name !== '✅') return;

  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
  } catch (err) {
    console.error('[suggestion] Failed to fetch:', err.message);
    return;
  }

  const message = reaction.message;
  if (message.channelId !== SUGGESTIONS_CHANNEL) return;
  if (processed.suggestions.has(message.id)) return;

  const count = reaction.count;
  if (count < REACTION_THRESHOLD) return;

  const content = message.content?.trim();
  if (!content) return;

  try {
    const title = content.length > 100 ? content.slice(0, 97) + '...' : content;
    const body = [
      `**Author:** ${message.author?.tag || 'Unknown'}`,
      '',
      '**Suggestion:**',
      content,
      '',
      `**Community support:** ${count} ✅`,
      `**Discord message:** ${messageLink(message)}`,
    ].join('\n');

    const url = await createIssue(title, body, ['suggestion', 'pending-review']);
    processed.suggestions.add(message.id);
    saveProcessed();
    console.log(`[suggestion] Issue created (${count} reactions): ${url}`);
  } catch (err) {
    console.error('[suggestion] Failed to create issue:', err.message);
  }
});

client.login(process.env.DISCORD_TOKEN);
