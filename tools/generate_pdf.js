const fs = require("fs");
const path = require("path");

const input = path.join(process.cwd(), "MINI_RAFT_WORKFLOW_REPORT.md");
const output = path.join(process.cwd(), "MINI_RAFT_WORKFLOW_REPORT.pdf");

const raw = fs.readFileSync(input, "utf8");

function cleanMarkdown(line) {
    return line
        .replace(/^#{1,6}\s*/, "")
        .replace(/^\-\s*/, "  - ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
        .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function wrapLine(line, width) {
    const words = line.split(/\s+/);
    const lines = [];
    let current = "";

    for (const word of words) {
        if (!word) continue;
        if ((current + " " + word).trim().length > width) {
            if (current) lines.push(current);
            current = word;
        } else {
            current = (current + " " + word).trim();
        }
    }

    if (current) lines.push(current);
    return lines.length ? lines : [""];
}

const textLines = [];
let inFence = false;

for (const originalLine of raw.split(/\r?\n/)) {
    if (originalLine.trim().startsWith("```")) {
        inFence = !inFence;
        textLines.push("");
        continue;
    }

    const line = inFence ? "    " + originalLine : cleanMarkdown(originalLine);
    if (!line.trim()) {
        textLines.push("");
        continue;
    }

    for (const wrapped of wrapLine(line, inFence ? 78 : 86)) {
        textLines.push(wrapped);
    }
}

const pageHeight = 792;
const pageWidth = 612;
const marginX = 54;
const startY = 748;
const lineHeight = 14;
const linesPerPage = 50;

const pages = [];
for (let i = 0; i < textLines.length; i += linesPerPage) {
    pages.push(textLines.slice(i, i + linesPerPage));
}

function escapePdfText(text) {
    return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const objects = [];
function addObject(body) {
    objects.push(body);
    return objects.length;
}

const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
const pagesId = addObject("");
const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

const pageIds = [];
for (const pageLines of pages) {
    const commands = [];
    commands.push("BT");
    commands.push("/F1 10 Tf");
    commands.push(`${marginX} ${startY} Td`);

    pageLines.forEach((line, index) => {
        if (index > 0) commands.push(`0 -${lineHeight} Td`);
        commands.push(`(${escapePdfText(line)}) Tj`);
    });

    commands.push("ET");

    const stream = commands.join("\n");
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
}

objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

let pdf = "%PDF-1.4\n";
const offsets = [0];

objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
});

const xrefOffset = Buffer.byteLength(pdf, "utf8");
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += "0000000000 65535 f \n";

for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
}

pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`;
pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

fs.writeFileSync(output, pdf, "binary");
console.log(output);
