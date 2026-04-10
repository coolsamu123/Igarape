import fs from 'fs';
import path from 'path';

const DRIVE_LOCAL_ROOT = path.join(process.cwd(), 'data', 'drive');

export interface ScannedProject {
  projectId: string;
  projectName: string;
  region: string;
  gate: string;
  monthFolders: string[];
  files: string[];
}

// Recursively collect all files under a directory
function collectFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (['.docx', '.xlsx', '.pdf', '.txt', '.csv'].includes(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

export function scanProjects(): ScannedProject[] {
  const projectMap = new Map<string, ScannedProject>();

  if (!fs.existsSync(DRIVE_LOCAL_ROOT)) {
    // Return empty if no drive data yet
    return [];
  }

  // Iterate over data/drive folders which are named `${projectId}_${projectName}`
  for (const entry of fs.readdirSync(DRIVE_LOCAL_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    
    const folderName = entry.name;
    const match = folderName.match(/^(PRJ[0-9]+)_(.+)$/);
    if (!match) continue;
    
    const projectId = match[1];
    const projectName = match[2];
    
    const projPath = path.join(DRIVE_LOCAL_ROOT, folderName);
    const files = collectFiles(projPath);
    
    if (files.length > 0) {
      projectMap.set(projectId, {
        projectId,
        projectName,
        region: 'Global', // Might not have this natively, so generic
        gate: 'Unknown',
        monthFolders: ['Drive Sync'],
        files,
      });
    }
  }

  return Array.from(projectMap.values());
}
