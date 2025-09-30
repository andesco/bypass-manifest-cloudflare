
import fs from 'fs/promises';
import path from 'path';

const filesToDownload = [
    'sites.js',
    'sites.json',
    'sites_updated.json',
    'sites_custom.json',
    'sites_aggregated.json',
    'sites_aggregated.yaml',
    'manifest.json'
];

const baseUrl = 'https://bypass.andrewe.dev';
const localDir = path.join(process.cwd(), 'local');

async function downloadFiles() {
    try {
        // First, initiate the update
        console.log('Initiating the update...');
        const updateResponse = await fetch(`${baseUrl}/initiate-update`);
        if (updateResponse.ok) {
            console.log('Update initiated successfully.');
        } else {
            console.warn(`Update initiation failed: ${updateResponse.statusText}`);
        }

        // Wait 10 seconds for the update to process
        console.log('Waiting 10 seconds for update to complete...');
        await new Promise(resolve => setTimeout(resolve, 10000));

        await fs.mkdir(localDir, { recursive: true });

        for (const file of filesToDownload) {
            const response = await fetch(`${baseUrl}/${file}`);
            if (response.ok) {
                let content = await response.text();
                const filePath = path.join(localDir, file);

                if (file === 'manifest.json') {
                    console.log('Anonymizing manifest.json...');
                    content = content.replace(new RegExp(baseUrl, 'g'), 'https://{domain}');
                }

                await fs.writeFile(filePath, content);
                console.log(`Downloaded and saved ${file} to ${filePath}`);
            } else {
                console.error(`Failed to download ${file}: ${response.statusText}`);
            }
        }
        console.log('All files downloaded successfully.');
    } catch (error) {
        console.error('An error occurred during the download process:', error);
    }
}

downloadFiles();
