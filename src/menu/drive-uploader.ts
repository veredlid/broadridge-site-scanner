/**
 * Uploads the batch menu-check output to Google Drive.
 *
 * Flow:
 *   1. Create a folder in Drive named "BR Menu QA — Wave1 Phase1 {date}"
 *   2. Upload each site's menu-report.html → collect {siteDirName → driveFileId}
 *   3. Regenerate index.html with absolute Drive view URLs
 *   4. Upload index.html
 *   5. Share the folder as "anyone with link can view"
 *   6. Return the shareable folder URL + index file URL
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import chalk from 'chalk';

// These are injected at runtime — the MCP client is not available in this module
// directly; instead we export a function that accepts an uploader callback.

export interface DriveFile {
  id: string;
  name: string;
  webViewLink: string;
}

export type UploadFn = (
  fileName: string,
  mimeType: string,
  base64Data: string,
  folderId?: string,
) => Promise<DriveFile>;

export type ShareFn = (fileId: string) => Promise<void>;

export interface DriveUploadResult {
  folderId: string;
  folderUrl: string;
  indexFileId: string;
  indexUrl: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toBase64(filePath: string): string {
  return readFileSync(filePath).toString('base64');
}

function buildDriveIndexHtml(
  originalIndexHtml: string,
  reportUrlMap: Map<string, string>,  // siteDirName → drive view URL
): string {
  // Replace relative report links (e.g. href="www.site.com/menu-report.html")
  // with the absolute Drive view URL.
  let html = originalIndexHtml;
  for (const [siteDirName, driveUrl] of reportUrlMap.entries()) {
    const relPath = `${siteDirName}/menu-report.html`;
    // Replace all occurrences of the relative path in href attributes
    html = html.replaceAll(`href="${relPath}"`, `href="${driveUrl}" target="_blank"`);
  }
  return html;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function uploadBatchReportsToDrive(
  outputDir: string,
  uploadFn: UploadFn,
  shareFn: ShareFn,
): Promise<DriveUploadResult> {
  const dateStr = new Date().toISOString().slice(0, 10);
  const folderName = `BR Menu QA — Wave1 Phase1 ${dateStr}`;

  console.log(chalk.cyan(`\nUploading to Google Drive: "${folderName}"`));

  // Step 1: Create folder (upload a folder-type file)
  console.log(chalk.yellow('  Creating Drive folder...'));
  const folder = await uploadFn(folderName, 'application/vnd.google-apps.folder', '', undefined);
  const folderId = folder.id;
  console.log(chalk.green(`  ✓ Folder created: ${folderId}`));

  // Step 2: Upload individual site reports
  const siteDirs = readdirSync(outputDir).filter((name) => {
    const fullPath = path.join(outputDir, name);
    return statSync(fullPath).isDirectory();
  });

  const reportUrlMap = new Map<string, string>();
  let uploaded = 0;

  console.log(chalk.yellow(`  Uploading ${siteDirs.length} site reports...`));
  for (const siteDirName of siteDirs) {
    const reportPath = path.join(outputDir, siteDirName, 'menu-report.html');
    if (!statSync(reportPath).isFile()) continue;

    try {
      const b64 = toBase64(reportPath);
      const driveFile = await uploadFn(`${siteDirName}.html`, 'text/html', b64, folderId);
      await shareFn(driveFile.id);
      reportUrlMap.set(siteDirName, driveFile.webViewLink);
      uploaded++;
      process.stdout.write(`\r    ${uploaded}/${siteDirs.length} reports uploaded`);
    } catch (err) {
      console.log(chalk.red(`\n    ✗ Failed to upload ${siteDirName}: ${(err as Error).message}`));
    }
  }
  console.log('');

  // Step 3: Regenerate index.html with Drive URLs
  const localIndexPath = path.join(outputDir, 'index.html');
  const originalIndex = readFileSync(localIndexPath, 'utf-8');
  const driveIndex = buildDriveIndexHtml(originalIndex, reportUrlMap);

  // Save updated index locally too
  const driveIndexPath = path.join(outputDir, 'index-drive.html');
  writeFileSync(driveIndexPath, driveIndex, 'utf-8');

  // Step 4: Upload index.html
  console.log(chalk.yellow('  Uploading index.html...'));
  const indexFile = await uploadFn('index.html', 'text/html', Buffer.from(driveIndex).toString('base64'), folderId);
  await shareFn(indexFile.id);
  console.log(chalk.green(`  ✓ Index uploaded`));

  // Step 5: Share folder
  console.log(chalk.yellow('  Sharing folder...'));
  await shareFn(folderId);
  console.log(chalk.green('  ✓ Folder shared (anyone with link can view)'));

  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;

  console.log(chalk.bold(`\n  Drive folder: ${folderUrl}`));
  console.log(chalk.bold(`  Index report: ${indexFile.webViewLink}`));

  return {
    folderId,
    folderUrl,
    indexFileId: indexFile.id,
    indexUrl: indexFile.webViewLink,
  };
}
