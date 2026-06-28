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

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  loadProcessed();
  await ensureLabels();
  console.log('Ready. Watching #bugs and #suggestions.');
});

// #bugs: every message → GitHub issue
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== BUGS_CHANNEL) return;
  if (processed.bugs.has(message.id)) return;

  const content = message.content.trim();
  if (!content) return;

  try {
    const title = content.length > 100
      ? content.slice(0, 97) + '...'
      : content;

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
    console.log(`[bug] Issue created: ${url}`);
  } catch (err) {
    console.error('[bug] Failed to create issue:', err.message);
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
    const title = content.length > 100
      ? content.slice(0, 97) + '...'
      : content;

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
