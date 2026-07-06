# Institute Management Portal

A centralized academic administration portal built using Node.js/Express + MySQL on the backend, and static HTML/CSS/JS on the frontend.

## Getting Started

1. Set up the environment variables in `.env`.
2. Seed the database using `project.sql`.
3. Start the application:
   ```bash
   node server.js
   ```

## Content Security Policy (CSP)

This project implements a strict Content Security Policy (CSP) using `helmet`. Legitimate inline script blocks are allowed via SHA-256 hashes generated from the HTML files in the `/public` directory.

### How it works
- CSP hashes are stored in `csp-hashes.json`.
- The Express server loads `csp-hashes.json` on startup and dynamically injects the hashes into `helmet`'s `contentSecurityPolicy.directives.scriptSrc` directive.
- Inline event handlers (like `onclick="..."`) have been completely eliminated in favor of standard event listeners and event delegation to maintain security without requiring `'unsafe-hashes'` or `'unsafe-inline'` for event attributes.

### Hash Regeneration
Contributors do not need to run hash generation manually because of a git pre-commit hook that automates this workflow:
- **Pre-commit Hook**: When you stage any file matching `public/**/*.html`, a pre-commit hook runs `npm run csp:build` and automatically stages the updated `csp-hashes.json`.
- **Manual Build**: If you ever need to manually regenerate the CSP hashes, run:
  ```bash
  npm run csp:build
  ```
- **CI Enforcement**: The CI pipeline (GitHub Actions) runs a check on pull requests and pushes to ensure that the committed `csp-hashes.json` is perfectly in sync with the current HTML files. If a commit bypasses git hooks (e.g. via `git commit --no-verify`) and has out-of-sync hashes, the build will fail.