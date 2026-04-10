import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

const MAX_TEXT_LENGTH = 80000; // Gemini pro context budget per project

export async function extractText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  try {
    if (ext === '.docx') {
      return await extractDocx(filePath, fileName);
    } else if (ext === '.xlsx') {
      return extractXlsx(filePath, fileName);
    } else if (ext === '.pdf') {
      return await extractPdf(filePath, fileName);
    } else if (ext === '.txt' || ext === '.csv') {
      return extractTxt(filePath, fileName);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `[Error extracting ${fileName}: ${msg}]`;
  }

  return '';
}

async function extractDocx(filePath: string, fileName: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value.trim();
  return text ? `\n--- FILE: ${fileName} ---\n${text}` : '';
}

function extractXlsx(filePath: string, fileName: string): string {
  const workbook = XLSX.readFile(filePath);
  const parts: string[] = [`\n--- FILE: ${fileName} ---`];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) {
      parts.push(`[Sheet: ${sheetName}]`);
      parts.push(csv);
    }
  }

  return parts.length > 1 ? parts.join('\n') : '';
}

function extractTxt(filePath: string, fileName: string): string {
  const text = fs.readFileSync(filePath, 'utf-8').trim();
  return text ? `\n--- FILE: ${fileName} ---\n${text}` : '';
}

async function extractPdf(filePath: string, fileName: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PDFParse } = require('pdf-parse');
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  const text = (result.text || '').trim();
  return text ? `\n--- FILE: ${fileName} ---\n${text}` : '';
}

export async function extractAllTexts(files: string[]): Promise<string> {
  const parts: string[] = [];
  let totalLength = 0;

  for (const file of files) {
    if (totalLength >= MAX_TEXT_LENGTH) break;

    const text = await extractText(file);
    if (text) {
      const remaining = MAX_TEXT_LENGTH - totalLength;
      const truncated = text.slice(0, remaining);
      parts.push(truncated);
      totalLength += truncated.length;
    }
  }

  return parts.join('\n');
}
