interface AdfTextNode {
  type: 'text';
  text: string;
}
interface AdfHardBreak {
  type: 'hardBreak';
}
interface AdfParagraph {
  type: 'paragraph';
  content: Array<AdfTextNode | AdfHardBreak>;
}
export interface AdfDoc {
  type: 'doc';
  version: 1;
  content: AdfParagraph[];
}

/**
 * Jira Cloud's v3 issue API rejects a plain-text `description` — it must be
 * Atlassian Document Format. This wraps plain text into the minimal valid
 * shape: blank lines become paragraph breaks, single newlines become
 * hardBreak nodes within a paragraph.
 */
export function textToAdf(text: string): AdfDoc {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.length > 0);
  const content: AdfParagraph[] = paragraphs.map((paragraph) => {
    const lines = paragraph.split('\n');
    const nodes: Array<AdfTextNode | AdfHardBreak> = [];
    lines.forEach((line, index) => {
      if (index > 0) nodes.push({ type: 'hardBreak' });
      if (line.length > 0) nodes.push({ type: 'text', text: line });
    });
    return { type: 'paragraph', content: nodes };
  });

  return {
    type: 'doc',
    version: 1,
    content: content.length > 0 ? content : [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
  };
}
