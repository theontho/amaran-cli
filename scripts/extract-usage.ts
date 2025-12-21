import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cheerio from 'cheerio';

const HTML_PATH = path.resolve('docs/howto-extract.html');
const OUTPUT_PATH = path.resolve('docs/USAGE_GUIDE.md');

function extractCode(
  $: cheerio.CheerioAPI,
  codeContainer: cheerio.Cheerio<any>
): { lang: string; code: string; title?: string } {
  let lang = 'text';
  const classes = codeContainer.attr('class') || '';
  const langMatch = classes.match(/language-(\w+)/);
  if (langMatch) {
    lang = langMatch[1];
  }

  const title = codeContainer.find('.codeBlockTitle_Ktv7').text().trim();

  let codeText = '';
  // Check if it's structured with token-lines (Docusaurus)
  const lines = codeContainer.find('.token-line');
  if (lines.length) {
    lines.each((_i, el) => {
      codeText += `${$(el as any)
        .text()
        .trim()}\n`;
    });
  } else {
    codeText = codeContainer.find('code').text().trim() || codeContainer.text().trim();
  }

  if (lang === 'json') {
    try {
      codeText = JSON.stringify(JSON.parse(codeText), null, 2);
    } catch (_e) {
      // Keep as is
    }
  }

  return { lang, code: codeText.trim(), title: title || undefined };
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

  if (headers.length === 0 && rows.length > 0) {
    // Handle cases where there might not be <thead> but just <tr> in <tbody> as headers
    // Not common in Docusaurus but good to have
    return '';
  }
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

  let markdown = '';
  const seenContent = new Set<string>();

  // Extract H1
  const h1 = $('h1').first().text().trim();
  if (h1) {
    markdown += `# ${h1}\n\n`;
  }

  // Find the main article or content area
  const content = $('article');

  // We want to iterate through the content children
  content
    .find('.theme-doc-markdown')
    .children()
    .each((_i, el) => {
      const $el = $(el as any);
      const tagName = (el as any).tagName ? (el as any).tagName.toLowerCase() : '';

      if (/^h[1-6]$/.test(tagName)) {
        const level = tagName[1];
        const text = $el.text().replace('​', '').trim(); // Remove zero-width spaces
        if (text && !seenContent.has(`H${level}:${text}`)) {
          markdown += `${'#'.repeat(parseInt(level, 10))} ${text}\n\n`;
          seenContent.add(`H${level}:${text}`);
        }
      } else if (tagName === 'p' || tagName === 'blockquote' || tagName === 'b' || tagName === 'i') {
        const text = $el.text().trim();
        if (text && !seenContent.has(text)) {
          if (tagName === 'blockquote' || tagName === 'b') {
            markdown += `> ${text}\n\n`;
          } else {
            markdown += `${text}\n\n`;
          }
          seenContent.add(text);
        }
      } else if (tagName === 'ul' || tagName === 'ol') {
        let listMd = '';
        $el.children('li').each((j, li) => {
          const prefix = tagName === 'ul' ? '*' : `${j + 1}.`;
          const $li = $(li);
          // Handle content of LI, which might contain nested ULs
          let liText = '';
          $li.contents().each((_k, node) => {
            if ((node as any).type === 'text') {
              liText += $(node as any)
                .text()
                .trim();
            } else if (
              (node as any).type === 'tag' &&
              ((node as any).tagName === 'ul' || (node as any).tagName === 'ol')
            ) {
              // Skip nested lists here, we will handle them if we want deep nesting,
              // but for now let's just avoid double printing.
              // Actually, let's just get the text of the LI but excluding nested UL/OL for the prefix line
            } else {
              liText += $(node as any)
                .text()
                .trim();
            }
          });
          listMd += `${prefix} ${liText.trim()}\n`;

          // If there's a nested list, let's indent it
          $li.children('ul, ol').each((_k, nested) => {
            const $nested = $(nested as any);
            const nestedTag = (nested as any).tagName ? (nested as any).tagName.toLowerCase() : '';
            $nested.children('li').each((l, nli) => {
              const nPrefix = nestedTag === 'ul' ? '  *' : `  ${l + 1}.`;
              listMd += `${nPrefix} ${$(nli as any)
                .text()
                .trim()}\n`;
            });
          });
        });
        if (listMd && !seenContent.has(listMd)) {
          markdown += `${listMd}\n`;
          seenContent.add(listMd);
        }
      } else if (tagName === 'table') {
        const tableMd = extractTable($, $el);
        if (tableMd && !seenContent.has(tableMd)) {
          markdown += `${tableMd}\n\n`;
          seenContent.add(tableMd);
        }
      } else if ($el.hasClass('codeBlockContainer_Ckt0')) {
        const { lang, code, title } = extractCode($, $el);
        const codeBlock = `${title ? `**${title}**\n` : ''}\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
        if (code && !seenContent.has(codeBlock)) {
          markdown += codeBlock;
          seenContent.add(codeBlock);
        }
      }
    });

  fs.writeFileSync(OUTPUT_PATH, `${markdown.trim()}\n`);
  console.log(`Successfully extracted Usage Guide to ${OUTPUT_PATH}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
