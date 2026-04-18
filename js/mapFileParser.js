/**
 * mapFileParser.js — Parses a map file text string into a TourMap data model.
 *
 * Handles all line types: # (comment), ! (title), + (prefix), $ (locale),
 * link lines (starting with digit), and description text lines.
 */

import { MapEntry, NAV_LINK_COMMANDS, HEADINGS } from './dataModel.js';

/**
 * Parse the full text of a map file into a structured result.
 * @param {string} text — the entire map file contents
 * @returns {{ title: string, filenamePrefix: string, entries: MapEntry[] }}
 */
export function parseMapFile(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let title = '';
  let filenamePrefix = '';
  /** @type {MapEntry[]} */
  const entries = [];

  // Current locale state (applied to subsequent link lines)
  let currentLocaleId = -1;
  let currentLocaleDescription = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Blank lines
    if (line.trim() === '') {
      const entry = new MapEntry();
      entry.type = 'blank';
      entry.raw = line;
      entries.push(entry);
      continue;
    }

    const firstChar = line.trimStart()[0];

    // Comment lines
    if (firstChar === '#') {
      const entry = new MapEntry();
      entry.type = 'comment';
      entry.raw = line;
      entries.push(entry);
      continue;
    }

    // Title lines
    if (firstChar === '!') {
      const entry = new MapEntry();
      entry.type = 'title';
      entry.raw = line;
      const titleText = line.substring(line.indexOf('!') + 1).trim();
      if (title) {
        title += ' ' + titleText;
      } else {
        title = titleText;
      }
      entries.push(entry);
      continue;
    }

    // Filename prefix lines
    if (firstChar === '+') {
      const entry = new MapEntry();
      entry.type = 'prefix';
      entry.raw = line;
      filenamePrefix = line.substring(line.indexOf('+') + 1).trim();
      entries.push(entry);
      continue;
    }

    // Locale lines
    if (firstChar === '$') {
      const entry = new MapEntry();
      entry.type = 'locale';
      entry.raw = line;

      const content = line.substring(line.indexOf('$') + 1).trim();
      // Extract optional locale number
      const numMatch = content.match(/^(\d+)\s*(.*)/);
      if (numMatch) {
        currentLocaleId = parseInt(numMatch[1], 10);
        currentLocaleDescription = numMatch[2].trim();
      } else {
        currentLocaleId++;
        currentLocaleDescription = content;
      }
      entry.localeId = currentLocaleId;
      entry.localeText = currentLocaleDescription;
      entries.push(entry);
      continue;
    }

    // Link lines — start with a digit
    if (firstChar >= '0' && firstChar <= '9') {
      const entry = parseLinkLine(line.trim());
      entry.localeId = currentLocaleId;
      entry.localeDescription = currentLocaleDescription;
      entries.push(entry);
      continue;
    }

    // Description text — attach to the most recent link entry
    const lastLink = findLastLinkEntry(entries);
    if (lastLink) {
      if (lastLink.description === '' || lastLink.description === lastLink.localeDescription) {
        // First description line: isolated from locale description
        lastLink.description = line.trim();
      } else {
        // Subsequent lines go to verbose description
        if (lastLink.verboseDescription) {
          lastLink.verboseDescription += ' ' + line.trim();
        } else {
          lastLink.verboseDescription = line.trim();
        }
      }
      // Store the raw description line as a separate entry for round-trip fidelity
      const descEntry = new MapEntry();
      descEntry.type = 'description';
      descEntry.raw = line;
      entries.push(descEntry);
    } else {
      // Orphan text line — treat as comment
      const entry = new MapEntry();
      entry.type = 'comment';
      entry.raw = line;
      entries.push(entry);
    }
  }

  // Set locale description for link entries that had it from the locale header
  // (already done inline above via currentLocaleDescription)

  return { title, filenamePrefix, entries };
}


/**
 * Find the last entry of type 'link' in the entries array.
 * @param {MapEntry[]} entries
 * @returns {MapEntry|null}
 */
function findLastLinkEntry(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === 'link') return entries[i];
  }
  return null;
}


/**
 * Parse a single link line into a MapEntry.
 * A link line looks like: "0710 hs o0711 f0931"
 * @param {string} line — trimmed link line text
 * @returns {import('./dataModel.js').MapEntry}
 */
export function parseLinkLine(line) {
  const entry = new MapEntry();
  entry.type = 'link';
  entry.raw = line;

  const tokens = tokenize(line);

  for (const token of tokens) {
    const firstChar = token[0];

    // Pure numeric — the photo ID
    if (firstChar >= '0' && firstChar <= '9') {
      entry.id = token;
      continue;
    }

    const cmd = firstChar.toLowerCase();
    const value = token.substring(1);

    switch (cmd) {
      // Heading
      case 'h':
        entry.heading = value.toUpperCase();
        break;

      // Image filename
      case 'i':
      case '"': {
        // Remove surrounding quotes
        let fname = cmd === '"' ? token : value;
        if (fname.startsWith('"')) fname = fname.substring(1);
        if (fname.endsWith('"')) fname = fname.substring(0, fname.length - 1);
        
        // If ends with backslash, it's just a path prefix — store as-is
        entry.customImage = fname;
        break;
      }

      // Home marker
      case 'y':
        entry.isHome = true;
        break;

      // External URL
      case 'x': {
        let urlPart = value;
        let label = 'Info';
        // Check for optional label in parens
        if (urlPart.startsWith('(')) {
          const closeParen = urlPart.indexOf(')');
          if (closeParen > 0) {
            label = urlPart.substring(1, closeParen);
            urlPart = urlPart.substring(closeParen + 1);
          }
        }
        // Remove surrounding quotes from URL
        if (urlPart.startsWith('"')) urlPart = urlPart.substring(1);
        if (urlPart.endsWith('"')) urlPart = urlPart.substring(0, urlPart.length - 1);
        entry.externalUrl = { url: urlPart, label };
        break;
      }

      // User-defined link
      case '=': {
        let rest = value;
        let label = '';
        if (rest.startsWith('(')) {
          const closeParen = rest.indexOf(')');
          if (closeParen > 0) {
            label = rest.substring(1, closeParen);
            rest = rest.substring(closeParen + 1);
          }
        }
        // Store targetId as a string
        const targetId = rest;
        if (targetId.length > 0) { // Check if it's not an empty string
          entry.userDefined = { label, targetId };
        }
        break;
      }

      // Navigation link commands
      default:
        if (NAV_LINK_COMMANDS.includes(cmd)) {
          // Store targetId as a string
          if (value.length > 0) {
            entry.links[cmd] = value;
          } else {
            entry.unsupportedTokens.push(token);
          }
        } else {
          // Unknown or unsupported command/token
          entry.unsupportedTokens.push(token);
        }
        break;
    }
  }

  // Initialize description from locale (will be augmented by description lines)
  // The caller sets localeDescription; here we initialize description to that.
  // Done in the main parse loop above instead.

  return entry;
}


/**
 * Tokenize a link line, respecting quoted strings and parenthesized text.
 * Tokens are separated by whitespace, but quoted strings and parens keep their
 * contents together even if they contain spaces.
 * @param {string} line
 * @returns {string[]}
 */
function tokenize(line) {
  const tokens = [];
  let i = 0;
  const len = line.length;

  while (i < len) {
    // Skip whitespace
    while (i < len && (line[i] === ' ' || line[i] === '\t')) i++;
    if (i >= len) break;

    let token = '';
    while (i < len && line[i] !== ' ' && line[i] !== '\t') {
      if (line[i] === '"') {
        // Consume quoted string including quotes
        token += line[i++]; // opening quote
        while (i < len && line[i] !== '"') {
          token += line[i++];
        }
        if (i < len) token += line[i++]; // closing quote
      } else if (line[i] === '(') {
        // Consume parenthesized string including parens
        token += line[i++]; // opening paren
        while (i < len && line[i] !== ')') {
          token += line[i++];
        }
        if (i < len) token += line[i++]; // closing paren
      } else {
        token += line[i++];
      }
    }

    if (token) tokens.push(token);
  }

  return tokens;
}
