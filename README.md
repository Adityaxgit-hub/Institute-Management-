# Institute Management Portal

A secure, centralized academic administration portal designed for modern educational institutes. Built with a robust **Node.js/Express** backend and a responsive, vanilla **HTML/CSS/JavaScript** frontend, it leverages **MySQL** for relational data persistence, **Socket.io** for real-time announcements, and **Backblaze B2 (S3-compatible)** for secure PDF document storage.

---

## Agenda & Project Goals
Educational institutions require secure, roles-based platforms to manage users, track academic progress, record attendance, and broadcast official notices. This project achieves these goals through:
* **Tight Role Segregation**: Clean boundaries between administrative control, teaching faculties, and students.
* **Security-First Architecture**: End-to-end security measures, including rate limiting, robust password lockouts, CSP inline script hashing, CSRF protection, and session-state encryption.
* **Cloud-First Document Management**: PDF notifications are uploaded directly to cloud storage (Backblaze B2) and served securely to clients via short-lived, pre-signed download links.
* **Developer Workflow Automation**: Automating security configuration checks (like CSP hash validation) during standard git workflows.

---

## Role Matrix & Features

### Admin
* **User Provisioning**: Bulk onboarding of students and faculty via CSV file uploads.
* **Academic Setup**: Create and configure departments, courses, and class allocations.
* **Notice Board Broadcasting**: Publish notifications targeted at specific departments, roles, or individual users.
* **Secure Attachments**: Upload official documents (PDFs) which are stored in private cloud buckets.

### Faculty
* **Academic Grading**: Record and update marks (assignments, midterms, end-semester exams, and vivas) for students in their assigned courses.
* **Attendance Management**: Take daily attendance sheets, tracking presence or absence dynamically.
* **Profile Management**: Update login credentials and security parameters.

### Student
* **Performance Dashboard**: Access detailed academic transcripts displaying marks by semester.
* **Attendance History**: Check attendance statistics and class presence reports.
* **Notification Inbox**: Read real-time and historical announcements with immediate, secure download links to private attachment PDFs.

---

## Key Technology Stack

### Backend
* **Runtime**: Node.js & Express
* **Database**: MySQL (using `mysql2` connection pooling)
* **Real-time Engine**: [Socket.io](http://Socket.io) (pushing notifications instantaneously to active web sessions)
* **Session Management**: Persistent sessions backed by `express-mysql-session`
* **File Uploads**: `multer` + `multer-s3` integration with the AWS S3 client SDK

### Frontend
* **Core**: Semantic HTML5, Vanilla CSS3 (custom responsive layouts), and Modern ES6 JavaScript.
* **Icons & Fonts**: Google Fonts (Inter), Icons8 assets.

### Security
* **Authentication**: Password hashing with `bcrypt` (10 salt rounds).
* **Brute-Force Lockout**: Dynamic session lockouts (5 failed attempts lock the account for 15 minutes).
* **Headers**: `helmet` configuring HTTP response headers.
* **CSP Integrity**: Local compilation/extraction of SHA-256 script hashes injected at runtime.
* **Transport Encryption**: Encrypted database pools (SSL/TLS support for cloud providers like TiDB and Aiven).
* **CSRF Mitigation**: Anti-CSRF token verification (`csurf`).

### Testing & Tooling
* **Test Suite**: Jest & Supertest covering authentication modules, grading constraints, and attendance records.
* **Hooks**: Husky & lint-staged managing pre-commit actions.

---

## Getting Started

### Prerequisites
* **Node.js**: `v18` or newer
* **MySQL Database Instance**: Local installation or cloud-hosted provider (e.g., Aiven, TiDB)
* **Backblaze B2 Bucket**: Set up a bucket (recommended private) for file storage
* **SendGrid Account**: For transactional OTP signup and password reset delivery

### Installation

1. **Clone & Install Dependencies**:
   ```bash
   git clone https://github.com/Adityaxgit-hub/Institute-Management-.git
   cd Institute-Management-
   npm install
   ```

2. **Configure Environment Variables**:
   Copy `.env.example` to `.env` and fill out your local credentials:
   ```bash
   cp .env.example .env
   ```

3. **Initialize the Database**:
   Import `project.sql` to construct your tables, relationships, and default admin account:
   ```bash
   mysql -u your_user -p your_db_name < project.sql
   ```

4. **Regenerate Script Hashes**:
   Generate the Content Security Policy script hashes for the static pages:
   ```bash
   npm run csp:build
   ```

5. **Start the Server**:
   ```bash
   node server.js
   ```
   Open `http://localhost:5000/login.html` to access the application.

---

## Testing

Execute automated unit tests with Jest:
```bash
npm test
```

---

## Content Security Policy (CSP) & Git Hooks

This project implements a strict Content Security Policy (CSP) to guard against Cross-Site Scripting (XSS) attacks.

### How it works
1. Inline JavaScript elements are parsed and hashed during the build phase (`npm run csp:build`).
2. CSP hashes are outputted to `csp-hashes.json`.
3. The Express app parses `csp-hashes.json` on boot and configures `helmet` with valid hashes.
4. Custom **Husky** hooks automate script hash compilation. Staging changes in HTML pages automatically triggers script hashing and commits the updated JSON file.
5. If script hashes are out of sync, CI pipelines reject the push to prevent site breakage.

---

> **⚠️ Security Warning**: Never commit `.env` or files storing active keys to version control. If credentials (such as DB passwords, SendGrid keys, or Backblaze secrets) are accidentally pushed, rotate them immediately in their respective cloud consoles.