import { readFileSync } from "node:fs";

const { version, build: { publish } } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
const token = process.env.GITHUB_RELEASE_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) throw new Error("Set GH_TOKEN before running npm run release.");

const api = `https://api.github.com/repos/${publish.owner}/${publish.repo}/releases`;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "User-Agent": "lumilan-chat-release",
};
async function github(url, init = {}) {
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${response.statusText}`);
  return response.json();
}

const tag = `v${version}`;
const releases = await github(`${api}?per_page=100`);
const matches = releases.filter(release => release.tag_name === tag);
if (matches.length > 1) throw new Error(`Found ${matches.length} drafts for ${tag}; keep one draft before retrying.`);
if (matches.length === 1) {
  if (!matches[0].draft) throw new Error(`${tag} is already published; increase the app version for a new release.`);
  console.log(`Using existing draft ${tag}.`);
} else {
  await github(api, { method: "POST", body: JSON.stringify({ tag_name: tag, name: version, draft: true }) });
  console.log(`Created draft ${tag}.`);
}
