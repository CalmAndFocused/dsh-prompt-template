/**
 * Generate a plugin market index (format 1) for this package.
 *
 * The index is the document a Discover source URL points at. It must be hosted
 * over HTTPS (or be same-origin with the index URL) and every `publishTimestamp`
 * must be the real npm publish time in Unix seconds, so the timestamp is read
 * from the registry rather than hand-written.
 *
 * The generated file is deliberately NOT shipped inside this package: its own
 * version's publish time cannot be known before publishing, so a bundled index
 * would always be stale (or a `--timestamp 0` placeholder). Host it separately.
 *
 * Usage:
 *   node scripts/make-index.mjs                 # requires the version on npm
 *   node scripts/make-index.mjs --timestamp 0   # local preview only
 *
 * Output: market/index.json
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Locale text the index format requires `en` for, with Chinese beside it. */
const TEXT = {
  title: { en: 'Prompt optimizer', zh: '提示词优化器' },
  description: {
    en: 'Rewrite the prompt you are drafting without leaving the composer: system prompt, user prompt, or iterate on an existing one.',
    zh: '在输入框里直接改写提示词：系统提示词、用户提示词，或在现有提示词上迭代。',
  },
  indexTitle: { en: 'My DSH plugins', zh: '我的 DSH 插件' },
  indexDescription: {
    en: 'Plugins published by this author.',
    zh: '本作者发布的插件。',
  },
};

/** Category id and its localized title; the validator rejects undeclared ids. */
const CATEGORY = {
  id: 'tools',
  title: { en: 'Tools & Capabilities', zh: '工具与能力' },
};

/**
 * Read the npm publish time of one exact version, in Unix seconds.
 * @param name - package name.
 * @param version - exact version.
 * @returns the publish timestamp.
 */
async function publishedAt(name, version) {
  const url = `https://registry.npmjs.org/${name.replace('/', '%2F')}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (response.status === 404) {
    throw new Error(
      `${name} is not on npm yet. Publish it first (npm publish), or pass --timestamp 0 for a local preview.`,
    );
  }
  if (!response.ok) throw new Error(`registry answered HTTP ${response.status} for ${name}`);
  const document = await response.json();
  const time = document?.time?.[version];
  if (typeof time !== 'string') {
    const known = Object.keys(document?.time ?? {}).filter((key) => key !== 'created' && key !== 'modified');
    const staged = known.some((key) => key.endsWith('-stage'))
      || Object.values(document?.versions ?? {}).some((entry) => String(entry?.description ?? '').includes('placeholder for staged publishing'));
    throw new Error(
      `${name}@${version} is not published. On npm: ${known.join(', ') || 'none'}.`
      + (staged
        ? ' A staged publish is pending: run "npm stage list ' + name + '", then '
          + '"npm stage approve <stage-id> --otp=<code>".'
        : ' Publish this version first, or pass --timestamp 0 for a local preview.'),
    );
  }
  return Math.floor(new Date(time).getTime() / 1000);
}

/** Inline the package icon as a `data:` URL, or nothing when it is too large. */
async function iconDataUrl() {
  try {
    const svg = await readFile(join(ROOT, 'icon.svg'));
    if (svg.byteLength > 32 * 1024) return undefined;
    return `data:image/svg+xml;base64,${svg.toString('base64')}`;
  } catch {
    return undefined;
  }
}

const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const overrideAt = process.argv.indexOf('--timestamp');
const timestamp = overrideAt === -1
  ? await publishedAt(manifest.name, manifest.version)
  : Number(process.argv[overrideAt + 1]);

if (!Number.isInteger(timestamp) || timestamp < 0) throw new Error('--timestamp must be a non-negative integer');

const icon = await iconDataUrl();

const index = {
  format: 1,
  title: TEXT.indexTitle,
  description: TEXT.indexDescription,
  metadata: { categories: { [CATEGORY.id]: { title: CATEGORY.title } }, labels: {}, sortKeys: {} },
  plugins: [
    {
      name: manifest.name,
      title: TEXT.title,
      description: TEXT.description,
      ...icon === undefined ? {} : { icon },
      ...manifest.author === undefined ? {} : { author: typeof manifest.author === 'string' ? manifest.author : manifest.author.name },
      ...manifest.homepage === undefined ? {} : { homepage: manifest.homepage },
      ...manifest.repository === undefined ? {} : {
        repository: {
          url: typeof manifest.repository === 'string' ? manifest.repository : manifest.repository.url,
          ...manifest.repository?.directory === undefined ? {} : { directory: manifest.repository.directory },
        },
      },
      metadata: {
        category: CATEGORY.id,
        keywords: Array.isArray(manifest.keywords) ? manifest.keywords : [],
        labels: [],
        sortKeys: {},
      },
      versions: [
        {
          version: manifest.version,
          publishTimestamp: timestamp,
          source: { type: 'npm' },
          ...manifest.engines?.dsh === undefined ? {} : { engines: { dsh: manifest.engines.dsh } },
        },
      ],
    },
  ],
};

const out = join(ROOT, 'market', 'index.json');
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
console.log(`wrote ${out}`);
