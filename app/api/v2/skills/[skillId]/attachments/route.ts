import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getSkillDetail, createContextFile } from '@/lib/services/skill-registry';
import { extractContextFileText, isImageMimeType, FileExtractionError, MAX_CONTEXT_FILE_SIZE } from '@/lib/services/file-extraction';
import { resolveSourceFromRequest } from '@/lib/api/resolve-source';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ skillId: string }> }
) {
  try {
    const { skillId } = await params;
    const sourceId = await resolveSourceFromRequest(req);

    const detail = getSkillDetail(skillId, sourceId);
    if (!detail) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    }

    const formData = await req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_CONTEXT_FILE_SIZE) {
      return NextResponse.json(
        { error: `File is too large (max ${Math.round(MAX_CONTEXT_FILE_SIZE / (1024 * 1024))}MB)` },
        { status: 400 }
      );
    }

    const filename = path.basename(file.name);
    const buffer = Buffer.from(await file.arrayBuffer());

    let extracted: { text: string; mimeType: string };
    try {
      extracted = await extractContextFileText(filename, buffer);
    } catch (err) {
      if (err instanceof FileExtractionError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    const attachmentsDir = path.join(process.cwd(), 'data', 'skill-attachments', sourceId ?? 'default', skillId);
    fs.mkdirSync(attachmentsDir, { recursive: true });
    const id = crypto.randomUUID();
    const rawPath = path.join(attachmentsDir, `${id}-${filename}`);
    fs.writeFileSync(rawPath, buffer);

    // For images there's no extracted text worth sidecaring — the raw file
    // itself is what the spawned analysis agent should view (it can read
    // images directly), so `textPath` points straight at `rawPath`. For
    // everything else, a plain-text file is written unconditionally (not
    // just for large files) so the agent always has something to Read —
    // generateAnalysisPrompt decides per-run whether to inline the text or
    // point at this path instead.
    const textPath = isImageMimeType(extracted.mimeType)
      ? rawPath
      : path.join(attachmentsDir, `${id}.extracted.md`);
    if (textPath !== rawPath) {
      fs.writeFileSync(textPath, extracted.text, 'utf8');
    }

    const record = createContextFile(skillId, filename, extracted.mimeType, buffer.length, rawPath, textPath, extracted.text, sourceId);
    const { extractedText, ...summary } = record;
    void extractedText;

    return NextResponse.json(summary, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
