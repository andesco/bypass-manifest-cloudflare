#!/usr/bin/env node

import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import os from 'os';

async function main() {
  console.log(chalk.blue('Normalize .JS and .JSON (remove white space) and compare MD5 hashes'));

  // Find possible uploads dirs
  const downloadsDir = path.join(os.homedir(), 'Downloads');
  const possibleDirs = fs.readdirSync(downloadsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && /_uploads$/.test(dirent.name))
    .map(dirent => path.join(downloadsDir, dirent.name));

  // Prompt for directories
  const dirPrompt = possibleDirs.length > 0 ? {
    type: 'list',
    name: 'uploadsDir',
    message: 'directory for uploads repository:',
    choices: possibleDirs
  } : {
    type: 'input',
    name: 'uploadsDir',
    message: 'directory for uploads repository:',
    default: path.join(os.homedir(), 'Downloads', 'my_uploads')
  };

  const answers = await inquirer.prompt([dirPrompt,
    {
      type: 'input',
      name: 'localDir',
      message: 'directory of local files:',
      default: path.join(os.homedir(), 'Developer', 'bypass-manifest-cloudflare', 'local')
    }
  ]);

  const BASE_DIR = answers.uploadsDir;
  const LOCAL_DIR = answers.localDir;
  const WORK_DIR = path.join(BASE_DIR, '_extracted');
  const fileTypes = ['sites.js', 'sites.json', 'sites_updated.json', 'sites_custom.json'];
  const searchOption = fileTypes.join(', ');

  // Extract archives if _extracted does not exist
  if (!fs.existsSync(WORK_DIR)) {
    fs.mkdirSync(WORK_DIR, { recursive: true });
    console.log(chalk.grey(`[*] Extracting archives from: ${BASE_DIR}`));

    const archives = execSync(`find "${BASE_DIR}" -maxdepth 1 -type f \\( -iname '*.zip' -o -iname '*.xpi' -o -iname '*.crx' \\)`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

    for (const file of archives) {
      const name = path.basename(file);
      const dest = path.join(WORK_DIR, name);
      fs.mkdirSync(dest, { recursive: true });

      console.log(chalk.gray(`    -> Extracting ${name} to ${dest}`));
      try {
        execSync(`unzip -qq -o "${file}" -d "${dest}"`, { stdio: 'pipe' });
      } catch {
        console.log(chalk.gray(`       [info] ${name} looks like CRX with header, stripping...`));
        const tmpzip = path.join(dest, 'tmp.zip');
        execSync(`tail -c +313 "${file}" > "${tmpzip}"`, { stdio: 'pipe' });
        execSync(`unzip -qq -o "${tmpzip}" -d "${dest}"`, { stdio: 'pipe' });
        fs.unlinkSync(tmpzip);
      }
    }
  }

  for (const fileType of fileTypes) {
    console.log(chalk.cyan(`${fileType}`));

    // Find target files for this type
    const findCmd = `find "${BASE_DIR}" "${WORK_DIR}" "${LOCAL_DIR}" -type f -name ${fileType} 2>/dev/null || true`;
    const targetFiles = execSync(findCmd, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

    const uniqueTargetFiles = [...new Set(targetFiles)];
    if (uniqueTargetFiles.length === 0) {
      console.log(`No ${fileType} files found.`);
      continue;
    }

    const groups = {};

    for (const f of uniqueTargetFiles) {
      const content = fs.readFileSync(f, 'utf8');
      const normalized = content.replace(/[\s\r\n]/g, '');
      const hash = crypto.createHash('md5').update(normalized).digest('hex');

      const relpath = path.relative(BASE_DIR, f);

      if (!groups[hash]) groups[hash] = [];
      groups[hash].push(relpath);
    }

    for (const [hash, files] of Object.entries(groups)) {
      console.log(chalk.grey(`${hash}`));
      for (const file of [...new Set(files)]) {  // unique
        let highlightedFile = file.replace(/(\d+\.\d+(?:\.\d+)*)/g, chalk.hex('#FFA500')('$1'));
        highlightedFile = highlightedFile.replace(/(\/local\/sites(?:_[^.]*)?\.(json|js))/g, chalk.cyan('$1'));
        console.log(chalk.gray(`   - ${highlightedFile}`));
      }
    }
  }
}

main().catch(console.error);
