import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cheerio from 'cheerio';

const HTML_PATH = path.resolve('docs/api-extract.html');
const OUTPUT_PATH = path.resolve('docs/API_REFERENCE.md');

function extractJson($: cheerio.CheerioAPI, codeBlock: cheerio.Cheerio<any>): string {
  let jsonText = '';
  codeBlock.find('.token-line').each((_i, el) => {
    jsonText += `${$(el as any)
      .text()
      .trim()}\n`;
  });

  if (!jsonText) {
    jsonText = codeBlock.text().trim();
  }

  try {
    // Try to parse and re-stringify to ensure it's clean
    return JSON.stringify(JSON.parse(jsonText), null, 2);
  } catch (_e) {
    // If parsing fails, return the raw text cleaned up a bit
    return jsonText.trim();
  }
}

function extractTable($: cheerio.CheerioAPI, table: cheerio.Cheerio<any>): string {
  const headers: string[] = [];
  table.find('thead th').each((_i, el) => {
    headers.push(
      $(el as any)
        .text()
        .trim()
    );
  });

  const rows: string[][] = [];
  table.find('tbody tr').each((_i, tr) => {
    const row: string[] = [];
    $(tr as any)
      .find('td')
      .each((_j, td) => {
        row.push(
          $(td as any)
            .text()
            .trim()
            .replace(/\n/g, ' ')
        );
      });
    rows.push(row);
  });

  if (headers.length === 0) return '';

  let md = `| ${headers.join(' | ')} |\n`;
  md += `| ${headers.map(() => '---').join(' | ')} |\n`;
  rows.forEach((row) => {
    md += `| ${row.join(' | ')} |\n`;
  });

  return md;
}

async function run() {
  if (!fs.existsSync(HTML_PATH)) {
    console.error(`Error: ${HTML_PATH} not found.`);
    process.exit(1);
  }

  const html = fs.readFileSync(HTML_PATH, 'utf-8');
  const $ = cheerio.load(html);

  let markdown = '# API Reference\n\n';
  markdown += '> This document is a compact version of the API documentation extracted from the local HTML dump.\n\n';

  $('h2.anchor').each((_i, el) => {
    const $el = $(el as any);
    const name = $el.text().replace('​', '').trim(); // Remove zero-width space
    markdown += `## ${name}\n\n`;

    const $blockquote = $el.next('blockquote');
    if ($blockquote.length) {
      markdown += `> ${$blockquote.text().trim()}\n\n`;
    }

    // Traverse until next h2
    let curr = $el.next();
    const seenContent = new Set<string>();

    while (curr.length && !curr.is('h2')) {
      const text = curr.text().trim().toLowerCase();

      if (curr.is('p')) {
        if (text === 'request') {
          markdown += '### Request\n\n';
        } else if (text === 'response') {
          markdown += '### Response\n\n';
        } else if (text) {
          // Skip empty paragraphs or labels we already handle
          if (text !== 'request' && text !== 'response') {
            const pText = curr.text().trim();
            if (!seenContent.has(pText)) {
              markdown += `${pText}\n\n`;
              seenContent.add(pText);
            }
          }
        }
      } else if (curr.hasClass('language-json')) {
        const json = extractJson($, curr);
        const codeBlock = `\`\`\`json\n${json}\n\`\`\`\n\n`;
        if (!seenContent.has(codeBlock)) {
          markdown += codeBlock;
          seenContent.add(codeBlock);
        }
      } else if (curr.is('table')) {
        const tableMd = extractTable($, curr);
        if (tableMd && !seenContent.has(tableMd)) {
          markdown += `${tableMd}\n\n`;
          seenContent.add(tableMd);
        }
      }

      // Also look inside divs if they contain the table or code
      if (curr.is('div')) {
        const jsonBlock = curr.find('.language-json');
        if (jsonBlock.length) {
          const json = extractJson($, jsonBlock);
          const codeBlock = `\`\`\`json\n${json}\n\`\`\`\n\n`;
          if (!seenContent.has(codeBlock)) {
            markdown += codeBlock;
            seenContent.add(codeBlock);
          }
        }

        const tableBlock = curr.find('table');
        if (tableBlock.length) {
          const tableMd = extractTable($, tableBlock);
          if (tableMd && !seenContent.has(tableMd)) {
            markdown += `${tableMd}\n\n`;
            seenContent.add(tableMd);
          }
        }
      }

      curr = curr.next();
    }
  });

  fs.writeFileSync(OUTPUT_PATH, markdown);
  console.log(`Successfully extracted API documentation to ${OUTPUT_PATH}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
