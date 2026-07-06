const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const publicDir = path.join(__dirname, "..", "public");
const outputFile = path.join(__dirname, "..", "csp-hashes.json");

// Recursive function to get all HTML files in a directory
function getHtmlFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;

  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getHtmlFiles(filePath));
    } else if (file.endsWith(".html")) {
      results.push(filePath);
    }
  });
  return results;
}

function generateHashes() {
  const htmlFiles = getHtmlFiles(publicDir);
  const scriptHashes = new Set();

  htmlFiles.forEach((file) => {
    const content = fs.readFileSync(file, "utf8");
    
    // Regular expression to match inline <script> blocks
    // This matches the <script> tags and extracts their inner contents.
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(content)) !== null) {
      const scriptTag = match[0];
      const scriptContent = match[1];

      // Skip external script tags that have a src attribute
      if (/\bsrc\s*=/i.test(scriptTag)) {
        continue;
      }

      // Normalize line endings to LF (\n) to match browser CSP hashing behavior across platforms
      const normalizedContent = scriptContent.replace(/\r\n/g, "\n");

      // Compute the SHA-256 hash of the normalized inner text block
      const hash = crypto
        .createHash("sha256")
        .update(normalizedContent)
        .digest("base64");
      
      scriptHashes.add(`'sha256-${hash}'`);
    }
  });

  const output = {
    scriptHashes: Array.from(scriptHashes).sort(),
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf8");
  console.log(`[CSP] Generated ${output.scriptHashes.length} script hashes in ${outputFile}`);
}

generateHashes();
