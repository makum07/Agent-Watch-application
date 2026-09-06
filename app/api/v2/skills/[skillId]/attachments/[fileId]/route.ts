import { NextRequest, NextResponse } from 'next/server';
import { getContextFile, getContextFileRawBuffer, deleteContextFile } from '@/lib/services/skill-registry';
import { isImageMimeType } from '@/lib/services/file-extraction';
import { resolveSourceFromRequest } from '@/lib/api/resolve-source';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params;
    const sourceId = await resolveSourceFromRequest(req);
    const file = getContextFile(fileId, sourceId);
    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    if (isImageMimeType(file.mimeType)) {
      const buffer = getContextFileRawBuffer(fileId, sourceId);
      if (!buffer) {
        return NextResponse.json({ error: 'Image file is missing on disk' }, { status: 404 });
      }
      return NextResponse.json({
        filename: file.filename,
        mimeType: file.mimeType,
        dataUrl: `data:${file.mimeType};base64,${buffer.toString('base64')}`,
      });
    }
    return NextResponse.json({ filename: file.filename, extractedText: file.extractedText });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ skillId: string; fileId: string }> }
) {
  try {
    const { fileId } = await params;
    const sourceId = await resolveSourceFromRequest(req);
    deleteContextFile(fileId, sourceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
