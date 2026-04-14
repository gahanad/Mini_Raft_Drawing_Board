const fs = require("fs");
const path = require("path");

const input = path.join(process.cwd(), "MINI_RAFT_WORKFLOW_REPORT.md");
const output = path.join(process.cwd(), "MINI_RAFT_WORKFLOW_REPORT.html");
const md = fs.readFileSync(input, "utf8");

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

const lines = md.split(/\r?\n/);
let html = "";
let inCode = false;
let paragraph = [];

function flushParagraph() {
    if (paragraph.length) {
        html += `<p>${paragraph.join(" ")}</p>\n`;
        paragraph = [];
    }
}

for (const line of lines) {
    if (line.trim().startsWith("```")) {
        flushParagraph();
        if (inCode) {
            html += "</code></pre>\n";
            inCode = false;
        } else {
            html += "<pre><code>";
            inCode = true;
        }
        continue;
    }

    if (inCode) {
        html += escapeHtml(line) + "\n";
        continue;
    }

    if (!line.trim()) {
        flushParagraph();
        continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
        flushParagraph();
        const level = Math.min(heading[1].length, 3);
        html += `<h${level}>${escapeHtml(heading[2])}</h${level}>\n`;
        continue;
    }

    const bullet = line.match(/^\-\s+(.*)$/);
    if (bullet) {
        flushParagraph();
        html += `<p class="bullet">• ${escapeHtml(bullet[1])}</p>\n`;
        continue;
    }

    paragraph.push(escapeHtml(line));
}

flushParagraph();

const document = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>MINI_RAFT Workflow Report</title>
<style>
@page { margin: 22mm 18mm; }
body {
    font-family: Arial, Helvetica, sans-serif;
    color: #111;
    line-height: 1.45;
    font-size: 11.5pt;
}
h1 {
    font-size: 24pt;
    margin: 0 0 18px;
    padding-bottom: 8px;
    border-bottom: 2px solid #222;
}
h2 {
    font-size: 16pt;
    margin-top: 24px;
    border-bottom: 1px solid #ccc;
    padding-bottom: 4px;
}
h3 {
    font-size: 13pt;
    margin-top: 18px;
}
p {
    margin: 7px 0;
}
.bullet {
    margin-left: 18px;
}
pre {
    background: #f4f4f4;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 10px;
    white-space: pre-wrap;
    font-size: 9.5pt;
    page-break-inside: avoid;
}
code {
    font-family: Consolas, "Courier New", monospace;
}
</style>
</head>
<body>
${html}
</body>
</html>`;

fs.writeFileSync(output, document, "utf8");
console.log(output);
