#!/usr/bin/env node
/**
 * Documentation Generator
 *
 * Converts README.md to a styled HTML document at docs/index.html
 * Run: npm run docs:generate
 * Watch: npm run docs:watch
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, watchFile } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const README_PATH = join(ROOT_DIR, 'README.md');
const DOCS_DIR = join(ROOT_DIR, 'docs');
const OUTPUT_PATH = join(DOCS_DIR, 'index.html');

/**
 * Simple markdown to HTML converter
 */
function markdownToHtml(markdown) {
  let html = markdown;

  // Escape HTML special chars in code blocks first (we'll restore them)
  const codeBlocks = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    codeBlocks.push(`<pre><code class="language-${lang || 'text'}">${escapedCode}</code></pre>`);
    return placeholder;
  });

  // Inline code (before other processing)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^######\s+(.*)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.*)$/gm, '<h4 id="$1">$1</h4>');
  html = html.replace(/^###\s+(.*)$/gm, '<h3 id="$1">$1</h3>');
  html = html.replace(/^##\s+(.*)$/gm, '<h2 id="$1">$1</h2>');
  html = html.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');

  // Clean up header IDs (make them URL-friendly)
  html = html.replace(/id="([^"]+)"/g, (match, id) => {
    const cleanId = id.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    return `id="${cleanId}"`;
  });

  // Bold and italic
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Images (badges)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="badge">');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');

  // Tables
  html = html.replace(/^\|(.+)\|$/gm, (match, content) => {
    const cells = content.split('|').map(c => c.trim());
    return `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
  });

  // Convert separator rows to header marker
  html = html.replace(/<tr><td>[-:]+<\/td>(<td>[-:]+<\/td>)*<\/tr>/g, '__TABLE_HEADER__');

  // Wrap consecutive table rows
  html = html.replace(/(<tr>.*?<\/tr>\n?)+/g, (match) => {
    if (match.includes('__TABLE_HEADER__')) {
      const parts = match.split('__TABLE_HEADER__');
      const headerRow = parts[0].replace(/<td>/g, '<th>').replace(/<\/td>/g, '</th>');
      const bodyRows = parts[1] || '';
      return `<table><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table>`;
    }
    return `<table>${match}</table>`;
  });

  // Lists (unordered)
  html = html.replace(/^(\s*)-\s+(.*)$/gm, (match, indent, content) => {
    const level = Math.floor(indent.length / 2);
    return `<li data-level="${level}">${content}</li>`;
  });

  // Wrap consecutive list items
  html = html.replace(/(<li[^>]*>.*?<\/li>\n?)+/g, (match) => {
    return `<ul>${match}</ul>`;
  });

  // Ordered lists
  html = html.replace(/^\d+\.\s+(.*)$/gm, '<oli>$1</oli>');
  html = html.replace(/(<oli>.*?<\/oli>\n?)+/g, (match) => {
    return `<ol>${match.replace(/oli>/g, 'li>')}</ol>`;
  });

  // Paragraphs (lines that aren't already wrapped)
  const lines = html.split('\n');
  const processed = [];
  let inParagraph = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isBlock = trimmed.startsWith('<h') ||
                   trimmed.startsWith('<ul') ||
                   trimmed.startsWith('<ol') ||
                   trimmed.startsWith('<table') ||
                   trimmed.startsWith('<hr') ||
                   trimmed.startsWith('<pre') ||
                   trimmed.startsWith('__CODE_BLOCK') ||
                   trimmed === '';

    if (isBlock) {
      if (inParagraph) {
        processed.push('</p>');
        inParagraph = false;
      }
      processed.push(line);
    } else if (!trimmed.startsWith('<')) {
      if (!inParagraph) {
        processed.push('<p>');
        inParagraph = true;
      }
      processed.push(line);
    } else {
      processed.push(line);
    }
  }
  if (inParagraph) processed.push('</p>');

  html = processed.join('\n');

  // Restore code blocks
  codeBlocks.forEach((block, i) => {
    html = html.replace(`__CODE_BLOCK_${i}__`, block);
  });

  return html;
}

/**
 * Extract table of contents from markdown
 */
function extractToc(markdown) {
  const toc = [];
  const headerRegex = /^(#{2,3})\s+(.+)$/gm;
  let match;

  while ((match = headerRegex.exec(markdown)) !== null) {
    const level = match[1].length;
    const title = match[2];
    const id = title.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');

    toc.push({ level, title, id });
  }

  return toc;
}

/**
 * Generate the full HTML document
 */
function generateHtml(markdown) {
  const content = markdownToHtml(markdown);
  const toc = extractToc(markdown);

  const tocHtml = toc.map(item => {
    const indent = item.level === 3 ? 'toc-sub' : '';
    return `<a href="#${item.id}" class="toc-link ${indent}">${item.title}</a>`;
  }).join('\n        ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Domain Monitor - Documentation</title>
  <meta name="description" content="Comprehensive documentation for Domain Monitor - a self-hosted domain management and monitoring system">
  <style>
    :root {
      --bg-primary: #ffffff;
      --bg-secondary: #f8f9fa;
      --bg-code: #f1f3f5;
      --text-primary: #212529;
      --text-secondary: #495057;
      --text-muted: #6c757d;
      --border-color: #dee2e6;
      --accent-color: #0066cc;
      --accent-hover: #0052a3;
      --success-color: #28a745;
      --warning-color: #ffc107;
      --danger-color: #dc3545;
      --sidebar-width: 280px;
      --header-height: 60px;
    }

    [data-theme="dark"] {
      --bg-primary: #1a1a2e;
      --bg-secondary: #16213e;
      --bg-code: #0f0f23;
      --text-primary: #e4e4e7;
      --text-secondary: #a1a1aa;
      --text-muted: #71717a;
      --border-color: #27272a;
      --accent-color: #60a5fa;
      --accent-hover: #93c5fd;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html {
      scroll-behavior: smooth;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      font-size: 16px;
    }

    /* Header */
    .header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: var(--header-height);
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      z-index: 100;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .logo {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--accent-color);
      text-decoration: none;
    }

    .version {
      font-size: 0.75rem;
      padding: 2px 8px;
      background: var(--accent-color);
      color: white;
      border-radius: 12px;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .search-box {
      position: relative;
    }

    .search-box input {
      padding: 8px 12px 8px 36px;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      background: var(--bg-primary);
      color: var(--text-primary);
      width: 250px;
      font-size: 0.875rem;
    }

    .search-box input:focus {
      outline: none;
      border-color: var(--accent-color);
    }

    .search-box::before {
      content: "🔍";
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 0.875rem;
    }

    .theme-toggle {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 8px 12px;
      cursor: pointer;
      font-size: 1rem;
      color: var(--text-primary);
    }

    .theme-toggle:hover {
      background: var(--bg-code);
    }

    /* Sidebar */
    .sidebar {
      position: fixed;
      top: var(--header-height);
      left: 0;
      width: var(--sidebar-width);
      height: calc(100vh - var(--header-height));
      background: var(--bg-secondary);
      border-right: 1px solid var(--border-color);
      overflow-y: auto;
      padding: 24px 0;
    }

    .toc-link {
      display: block;
      padding: 8px 24px;
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 0.875rem;
      border-left: 3px solid transparent;
      transition: all 0.2s;
    }

    .toc-link:hover {
      color: var(--accent-color);
      background: var(--bg-code);
    }

    .toc-link.active {
      color: var(--accent-color);
      border-left-color: var(--accent-color);
      background: var(--bg-code);
    }

    .toc-link.toc-sub {
      padding-left: 40px;
      font-size: 0.8125rem;
    }

    /* Main Content */
    .main {
      margin-left: var(--sidebar-width);
      margin-top: var(--header-height);
      padding: 48px;
      max-width: 900px;
    }

    /* Typography */
    h1, h2, h3, h4, h5, h6 {
      margin-top: 2rem;
      margin-bottom: 1rem;
      font-weight: 600;
      line-height: 1.3;
    }

    h1 { font-size: 2.5rem; margin-top: 0; }
    h2 { font-size: 1.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-color); }
    h3 { font-size: 1.375rem; }
    h4 { font-size: 1.125rem; }

    p {
      margin-bottom: 1rem;
      color: var(--text-secondary);
    }

    a {
      color: var(--accent-color);
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    strong {
      font-weight: 600;
      color: var(--text-primary);
    }

    /* Code */
    code {
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace;
      font-size: 0.875em;
      background: var(--bg-code);
      padding: 2px 6px;
      border-radius: 4px;
      color: var(--accent-color);
    }

    pre {
      background: var(--bg-code);
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 1rem 0;
      border: 1px solid var(--border-color);
    }

    pre code {
      background: none;
      padding: 0;
      font-size: 0.875rem;
      color: var(--text-primary);
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
      font-size: 0.875rem;
    }

    th, td {
      padding: 12px;
      text-align: left;
      border: 1px solid var(--border-color);
    }

    th {
      background: var(--bg-secondary);
      font-weight: 600;
    }

    tr:hover {
      background: var(--bg-secondary);
    }

    /* Lists */
    ul, ol {
      margin: 1rem 0;
      padding-left: 2rem;
    }

    li {
      margin-bottom: 0.5rem;
      color: var(--text-secondary);
    }

    /* Badges */
    .badge {
      height: 20px;
      vertical-align: middle;
      margin-right: 4px;
    }

    /* Horizontal Rule */
    hr {
      border: none;
      border-top: 1px solid var(--border-color);
      margin: 2rem 0;
    }

    /* Search Results */
    .search-results {
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      margin-top: 4px;
      max-height: 300px;
      overflow-y: auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }

    .search-results.active {
      display: block;
    }

    .search-result-item {
      padding: 12px 16px;
      cursor: pointer;
      border-bottom: 1px solid var(--border-color);
    }

    .search-result-item:hover {
      background: var(--bg-secondary);
    }

    .search-result-item:last-child {
      border-bottom: none;
    }

    /* Mobile Responsive */
    @media (max-width: 768px) {
      .sidebar {
        display: none;
      }

      .main {
        margin-left: 0;
        padding: 24px;
      }

      .search-box input {
        width: 150px;
      }

      h1 { font-size: 1.75rem; }
      h2 { font-size: 1.375rem; }
      h3 { font-size: 1.125rem; }
    }

    /* Print Styles */
    @media print {
      .header, .sidebar {
        display: none;
      }

      .main {
        margin: 0;
        padding: 0;
        max-width: 100%;
      }
    }

    /* Auto-generated notice */
    .auto-generated {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-align: center;
      padding: 16px;
      border-top: 1px solid var(--border-color);
      margin-top: 48px;
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="header-left">
      <a href="#" class="logo">📡 Domain Monitor</a>
      <span class="version">v2.0.0</span>
    </div>
    <div class="header-right">
      <div class="search-box">
        <input type="text" id="search" placeholder="Search documentation..." autocomplete="off">
        <div class="search-results" id="searchResults"></div>
      </div>
      <button class="theme-toggle" id="themeToggle" title="Toggle theme">🌙</button>
    </div>
  </header>

  <aside class="sidebar">
    <nav class="toc">
      ${tocHtml}
    </nav>
  </aside>

  <main class="main">
    ${content}
    <div class="auto-generated">
      This documentation was auto-generated from README.md<br>
      Last updated: ${new Date().toISOString().split('T')[0]}
    </div>
  </main>

  <script>
    // Theme toggle
    const themeToggle = document.getElementById('themeToggle');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    function setTheme(dark) {
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      themeToggle.textContent = dark ? '☀️' : '🌙';
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    }

    // Initialize theme
    const savedTheme = localStorage.getItem('theme');
    setTheme(savedTheme ? savedTheme === 'dark' : prefersDark);

    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      setTheme(!isDark);
    });

    // Active section highlighting
    const tocLinks = document.querySelectorAll('.toc-link');
    const sections = document.querySelectorAll('h2[id], h3[id]');

    function updateActiveSection() {
      const scrollPos = window.scrollY + 100;

      let current = '';
      sections.forEach(section => {
        if (section.offsetTop <= scrollPos) {
          current = section.getAttribute('id');
        }
      });

      tocLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === '#' + current) {
          link.classList.add('active');
        }
      });
    }

    window.addEventListener('scroll', updateActiveSection);
    updateActiveSection();

    // Search functionality
    const searchInput = document.getElementById('search');
    const searchResults = document.getElementById('searchResults');
    const mainContent = document.querySelector('.main');

    const searchableContent = [];
    sections.forEach(section => {
      const id = section.getAttribute('id');
      const title = section.textContent;
      let content = '';
      let sibling = section.nextElementSibling;
      while (sibling && !sibling.matches('h2, h3')) {
        content += sibling.textContent + ' ';
        sibling = sibling.nextElementSibling;
      }
      searchableContent.push({ id, title, content: content.toLowerCase() });
    });

    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();

      if (query.length < 2) {
        searchResults.classList.remove('active');
        return;
      }

      const results = searchableContent.filter(item =>
        item.title.toLowerCase().includes(query) ||
        item.content.includes(query)
      ).slice(0, 8);

      if (results.length === 0) {
        searchResults.innerHTML = '<div class="search-result-item">No results found</div>';
      } else {
        searchResults.innerHTML = results.map(item =>
          \`<div class="search-result-item" data-id="\${item.id}">\${item.title}</div>\`
        ).join('');
      }

      searchResults.classList.add('active');
    });

    searchResults.addEventListener('click', (e) => {
      const item = e.target.closest('.search-result-item');
      if (item && item.dataset.id) {
        window.location.hash = item.dataset.id;
        searchResults.classList.remove('active');
        searchInput.value = '';
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box')) {
        searchResults.classList.remove('active');
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Cmd/Ctrl + K to focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInput.focus();
      }
      // Escape to close search
      if (e.key === 'Escape') {
        searchResults.classList.remove('active');
        searchInput.blur();
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);
  const watchMode = args.includes('--watch') || args.includes('-w');

  // Ensure docs directory exists
  if (!existsSync(DOCS_DIR)) {
    mkdirSync(DOCS_DIR, { recursive: true });
    console.log('📁 Created docs/ directory');
  }

  function generate() {
    try {
      const markdown = readFileSync(README_PATH, 'utf-8');
      const html = generateHtml(markdown);
      writeFileSync(OUTPUT_PATH, html, 'utf-8');
      console.log(`✅ Generated docs/index.html (${(html.length / 1024).toFixed(1)} KB)`);
    } catch (error) {
      console.error('❌ Error generating documentation:', error.message);
      process.exit(1);
    }
  }

  // Initial generation
  generate();

  // Watch mode
  if (watchMode) {
    console.log('👀 Watching for changes to README.md...');
    watchFile(README_PATH, { interval: 1000 }, () => {
      console.log('📝 README.md changed, regenerating...');
      generate();
    });
  }
}

main();
