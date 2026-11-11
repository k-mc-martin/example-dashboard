import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export type ReportSection = { title: string; lines: string[] };
export type ReviewReport = {
  title: string;
  revision: string;
  generated: string;
  introduction: string;
  sections: ReportSection[];
};

export async function reportPdf(report: ReviewReport) {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(report.title);
  doc.setAuthor('SecDash');
  const ink = rgb(0.07, 0.12, 0.19),
    accent = rgb(0.05, 0.33, 0.36);
  const paper: [number, number] = [612, 792],
    margin = 46,
    width = 520;
  let page = doc.addPage(paper),
    y = 0;
  function header() {
    page.drawText('SecDash  /  Verification report', {
      x: margin,
      y: 747,
      size: 11,
      font: bold,
      color: accent,
    });
    page.drawLine({
      start: { x: margin, y: 735 },
      end: { x: 566, y: 735 },
      thickness: 1,
      color: accent,
    });
    y = 706;
  }
  function space(height: number) {
    if (y - height < 62) {
      page = doc.addPage(paper);
      header();
    }
  }
  function write(value: string, size = 10, heading = false) {
    // Built-in PDF fonts support Latin text. Keep reports portable without an external font service.
    const text = value
      .replace(/[–—→]/g, ' - ')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[^\x20-\x7e\u00a0-\u00ff]/g, ' ');
    const font = heading ? bold : regular,
      lineHeight = size * 1.45;
    let line = '';
    const flush = () => {
      space(lineHeight);
      page.drawText(line, {
        x: margin,
        y,
        size,
        font,
        color: heading ? accent : ink,
      });
      y -= lineHeight;
      line = '';
    };
    for (const word of text.split(/\s+/)) {
      if (line && font.widthOfTextAtSize(line + ' ' + word, size) > width) flush();
      if (font.widthOfTextAtSize(word, size) <= width) {
        line += (line ? ' ' : '') + word;
        continue;
      }
      for (const character of word) {
        if (font.widthOfTextAtSize(line + character, size) > width) flush();
        line += character;
      }
    }
    if (line) flush();
  }
  header();
  write(report.title, 22, true);
  write('Prepared ' + report.generated, 10);
  write('Build ' + report.revision, 10);
  y -= 8;
  write(report.introduction, 11);
  y -= 8;
  for (const part of report.sections) {
    space(49);
    write(part.title, 14, true);
    for (const line of part.lines) {
      write(line);
      y -= 2;
    }
    y -= 10;
  }
  const pages = doc.getPages();
  pages.forEach((p, i) =>
    p.drawText('SecDash   |   ' + (i + 1) + ' / ' + pages.length, {
      x: margin,
      y: 32,
      size: 9,
      font: regular,
      color: accent,
    }),
  );
  return new Uint8Array(await doc.save());
}

export async function pdfDownload(report: ReviewReport, filename: string) {
  const bytes = await reportPdf(report);
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="' + filename + '"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
