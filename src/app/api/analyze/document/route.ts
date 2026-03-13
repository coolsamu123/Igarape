import { NextRequest, NextResponse } from 'next/server';
import { analyzeWithDocuments } from '@/lib/gemini';
import { getDb } from '@/lib/db';
import type { ProjectSummary } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projects, urls } = body as {
      projects: ProjectSummary[];
      urls: string[];
    };

    if (!projects || projects.length < 1) {
      return NextResponse.json({ error: 'At least 1 project required' }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY not configured. Add it to .env.local' },
        { status: 500 }
      );
    }

    // Fetch document content (with caching)
    const documentTexts: { url: string; content: string }[] = [];
    const db = getDb();

    for (const url of (urls || [])) {
      if (!url) continue;

      // Check cache
      const cached = db.prepare(
        'SELECT content_text, fetch_status FROM documents_cache WHERE url = ?'
      ).get(url) as { content_text: string; fetch_status: string } | undefined;

      if (cached && cached.fetch_status === 'success') {
        documentTexts.push({ url, content: cached.content_text });
        continue;
      }

      // Fetch from URL
      try {
        const response = await fetch(url, {
          headers: { 'Accept': 'text/html,text/plain,application/pdf' },
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
          db.prepare(`
            INSERT OR REPLACE INTO documents_cache (url, fetch_status, error_message)
            VALUES (?, 'error', ?)
          `).run(url, `HTTP ${response.status}`);
          continue;
        }

        const contentType = response.headers.get('content-type') || '';
        let text = '';

        if (contentType.includes('text/html') || contentType.includes('text/plain')) {
          text = await response.text();
          // Strip HTML tags for cleaner text
          text = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        } else {
          text = `[Binary document: ${contentType}] — Content could not be extracted as text.`;
        }

        // Cache the result
        db.prepare(`
          INSERT OR REPLACE INTO documents_cache (url, content_text, content_type, fetch_status)
          VALUES (?, ?, ?, 'success')
        `).run(url, text.slice(0, 50000), contentType);

        documentTexts.push({ url, content: text });
      } catch (fetchErr: unknown) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        db.prepare(`
          INSERT OR REPLACE INTO documents_cache (url, fetch_status, error_message)
          VALUES (?, 'error', ?)
        `).run(url, msg);
      }
    }

    const result = await analyzeWithDocuments(projects, documentTexts);
    return NextResponse.json({
      analysis: result,
      documentsProcessed: documentTexts.length,
      documentsRequested: (urls || []).length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
