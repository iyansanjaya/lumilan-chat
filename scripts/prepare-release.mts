import { readFileSync } from "node:fs";

const metadata: unknown = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
);
if (!metadata || typeof metadata !== 'object' || !('version' in metadata) || typeof metadata.version !== 'string' ||
    !('build' in metadata) || !metadata.build || typeof metadata.build !== 'object' || !('publish' in metadata.build) ||
    !metadata.build.publish || typeof metadata.build.publish !== 'object' || !('owner' in metadata.build.publish) ||
    typeof metadata.build.publish.owner !== 'string' || !('repo' in metadata.build.publish) || typeof metadata.build.publish.repo !== 'string') {
  throw new Error('Invalid release metadata in package.json.');
}
const version = metadata.version, publish = metadata.build.publish;
interface Release { tag_name: string; draft: boolean }
function releaseList(value: unknown): Release[] {
  if (!Array.isArray(value)) throw new Error('GitHub releases response must be an array.');
  return value.map((release: unknown) => {
    if (!release || typeof release !== 'object' || !('tag_name' in release) || typeof release.tag_name !== 'string' ||
        !('draft' in release) || typeof release.draft !== 'boolean') throw new Error('Invalid GitHub release response.');
    return { tag_name: release.tag_name, draft: release.draft };
  });
}
const token = process.env.GITHUB_RELEASE_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) throw new Error("Set GH_TOKEN before running npm run release.");

const api = `https://api.github.com/repos/${publish.owner}/${publish.repo}/releases`;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "User-Agent": "lumilan-chat-release",
};
async function github(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${response.statusText}`);
  return response.json();
}

const tag = `v${version}`;
const releases = releaseList(await github(`${api}?per_page=100`));
const matches = releases.filter(release => release.tag_name === tag);
if (matches.length > 1) throw new Error(`Found ${matches.length} drafts for ${tag}; keep one draft before retrying.`);
if (matches.length === 1) {
  if (!matches[0]!.draft) throw new Error(`${tag} is already published; increase the app version for a new release.`);
  console.log(`Using existing draft ${tag}.`);
} else {
  await github(api, { method: "POST", body: JSON.stringify({ tag_name: tag, name: version, draft: true }) });
  console.log(`Created draft ${tag}.`);
}
