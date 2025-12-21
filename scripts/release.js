#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (question) => {
  return new Promise((resolve) => rl.question(question, resolve));
};

const runCommand = (command) => {
  console.log(`Running: ${command}`);
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    process.exit(1);
  }
};

const updateChangelog = async (version, releaseNotes) => {
  const changelogPath = path.join(__dirname, '../docs/CHANGELOG.md');
  let changelog = '';
  
  try {
    changelog = fs.readFileSync(changelogPath, 'utf8');
  } catch (error) {
    console.log('No existing CHANGELOG.md found, creating a new one.');
  }

  const today = new Date().toISOString().split('T')[0];
  const newEntry = `## [${version}] - ${today}\n\n${releaseNotes}\n\n`;
  
  fs.writeFileSync(changelogPath, newEntry + changelog);
  console.log('CHANGELOG.md has been updated');
};

const main = async () => {
  try {
    // Ensure we're on the main branch and up to date
    runCommand('git checkout main');
    runCommand('git pull --tags origin main');

    // Get current version
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    console.log(`Current version: ${packageJson.version}`);

    // Ask for new version
    const newVersion = await askQuestion('Enter new version (e.g., 1.2.3): ');
    if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
      throw new Error('Version must be in format x.y.z');
    }

    // Ask for release notes
    console.log('\nEnter release notes (press Enter then Ctrl+D when done):');
    let releaseNotes = '';
    
    const lines = [];
    for await (const line of rl) {
      lines.push(line);
    }
    releaseNotes = lines.join('').trim();

    if (!releaseNotes) {
      throw new Error('Release notes cannot be empty');
    }

    // Update package.json version
    packageJson.version = newVersion;
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');
    console.log('Updated package.json version');

    // Update CHANGELOG.md
    await updateChangelog(newVersion, releaseNotes);

    // Commit changes
    runCommand('git add package.json docs/CHANGELOG.md');
    runCommand(`git commit -m "chore(release): v${newVersion}"`);
    runCommand(`git tag -a v${newVersion} -m "v${newVersion}"`);

    // Push changes
    runCommand('git push origin main --tags');

    // Create GitHub release using GitHub CLI if available
    try {
      runCommand(`gh release create v${newVersion} --notes "${releaseNotes}"`);
      console.log(`\n🎉 Successfully created release v${newVersion} on GitHub!`);
    } catch (error) {
      console.warn('\nGitHub CLI not found or failed to create release.');
      console.log('Please create the release manually at: https://github.com/theontho/amaran-cli/releases/new');
    }

    console.log(`\n🚀 Release v${newVersion} is ready to go!`);
    console.log('The GitHub Action will automatically publish to npm when the tag is pushed.');
  } catch (error) {
    console.error('\n❌ Release failed:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
};

main();
