const fs = require("fs");
const path = require("path");

const input = path.join(process.cwd(), "MINI_RAFT_WORKFLOW_REPORT.md");
const output = path.join(process.cwd(), "MINI_RAFT_WORKFLOW_REPORT.rtf");
const md = fs.readFileSync(input, "utf8");

function escapeRtf(text) {
    return text
        .replace(/\\/g, "\\\\")
        .replace(/\{/g, "\\{")
        .replace(/\}/g, "\\}")
        .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

let rtf = "{\\rtf1\\ansi\\deff0\n";
rtf += "{\\fonttbl{\\f0 Arial;}{\\f1 Consolas;}}\n";
rtf += "\\paperw11900\\paperh16840\\margl1200\\margr1200\\margt1000\\margb1000\n";
rtf += "\\fs22\n";

let inCode = false;

for (const line of md.split(/\r?\n/)) {
    if (line.trim().startsWith("```")) {
        inCode = !inCode;
        rtf += "\\par\n";
        continue;
    }

    if (!line.trim()) {
        rtf += "\\par\n";
        continue;
    }

    if (inCode) {
        rtf += `\\f1\\fs18 ${escapeRtf(line)}\\f0\\fs22\\par\n`;
        continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
        const level = heading[1].length;
        const size = level === 1 ? 34 : level === 2 ? 28 : 24;
        rtf += `\\b\\fs${size} ${escapeRtf(heading[2])}\\b0\\fs22\\par\n`;
        continue;
    }

    const bullet = line.match(/^\-\s+(.*)$/);
    if (bullet) {
        rtf += `\\li360 \\bullet\\tab ${escapeRtf(bullet[1])}\\li0\\par\n`;
        continue;
    }

    const text = line
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\[(.*?)\]\((.*?)\)/g, "$1");

    rtf += `${escapeRtf(text)}\\par\n`;
}

rtf += "}\n";
fs.writeFileSync(output, rtf, "utf8");
console.log(output);
