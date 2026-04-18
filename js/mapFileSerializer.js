/**
 * mapFileSerializer.js — Serializes a TourMap data model back to map file text.
 *
 * Preserves original formatting by using the raw text stored in each entry
 * when available. For modified/new entries, generates text from the data model.
 */

import { NAV_LINK_COMMANDS } from './dataModel.js';

/**
 * Serialize the entries array back to map file text.
 * @param {{ title: string, filenamePrefix: string, entries: import('./dataModel.js').MapEntry[] }} mapData
 * @returns {string}
 */
export function serializeMapFile(mapData) {
  const lines = [];

  if (mapData.title) {
    lines.push('! ' + mapData.title);
  }
  if (mapData.filenamePrefix) {
    lines.push('+ ' + mapData.filenamePrefix);
  }

  // To preserve the legacy format invariant where a Locale header captures ALL subsequent 
  // lines until the next header, we MUST output all UNASSIGNED links BEFORE any Locale headers.
  const unassigned = [];
  const localesMap = new Map(); // localeId -> { header: string|null, entries: string[] }

  // Helper to serialize an individual entry string
  const getOutputStrings = (entry) => {
    const outs = [];
    switch (entry.type) {
      case 'comment':
      case 'blank':
        outs.push(entry.raw);
        break;
      case 'locale':
        outs.push(serializeLocale(entry));
        break;
      case 'link':
        outs.push(entry.raw || serializeLinkLine(entry));
        if (entry.description && entry.description.trim() !== '' && entry.description !== entry.localeDescription) {
          outs.push(entry.description);
        }
        if (entry.verboseDescription && entry.verboseDescription.trim() !== '') {
          outs.push(entry.verboseDescription);
        }
        break;
    }
    return outs;
  };

  let currentWorkingLocale = null;

  for (const entry of mapData.entries) {
    if (entry.type === 'title' || entry.type === 'prefix' || entry.type === 'description') {
      continue;
    }

    if (entry.type === 'locale') {
      if (!localesMap.has(entry.localeId)) {
        localesMap.set(entry.localeId, { header: null, entries: [] });
      }
      localesMap.get(entry.localeId).header = serializeLocale(entry);
      currentWorkingLocale = entry.localeId;
    } 
    else if (entry.type === 'link') {
      if (entry.localeId === null || entry.localeId === -1) {
        unassigned.push(...getOutputStrings(entry));
        currentWorkingLocale = null;
      } else {
        if (!localesMap.has(entry.localeId)) {
          localesMap.set(entry.localeId, { header: null, entries: [] });
        }
        localesMap.get(entry.localeId).entries.push(...getOutputStrings(entry));
        currentWorkingLocale = entry.localeId;
      }
    } 
    else if (entry.type === 'comment' || entry.type === 'blank') {
      if (currentWorkingLocale !== null && localesMap.has(currentWorkingLocale)) {
        localesMap.get(currentWorkingLocale).entries.push(entry.raw);
      } else {
        unassigned.push(entry.raw);
      }
    }
  }

  // 1. Emit Unassigned
  if (unassigned.length > 0) {
    lines.push(...unassigned);
  }

  // 2. Emit each Locale group
  for (const [locId, data] of localesMap.entries()) {
    const headerStr = data.header || ('$' + locId + ' (Generated Header)');
    lines.push(headerStr);
    lines.push(...data.entries);
  }

  return lines.join('\n');
}


/**
 * Serialize a locale entry.
 * @param {import('./dataModel.js').MapEntry} entry
 * @returns {string}
 */
function serializeLocale(entry) {
  if (entry.localeId !== null && entry.localeId >= 0) {
    const text = entry.localeText ? ' ' + entry.localeText : '';
    return '$' + entry.localeId + text;
  }
  return '$' + (entry.localeText || '');
}


/**
 * Serialize a link line from model data (without trailing descriptions).
 * @param {import('./dataModel.js').MapEntry} entry
 * @returns {string}
 */
export function serializeLinkLine(entry) {
  const parts = [];

  // Photo ID
  if (entry.id !== null) {
    parts.push(String(entry.id));
  }

  // Custom image filename
  if (entry.customImage) {
    parts.push('i"' + entry.customImage + '"');
  }

  // Heading
  if (entry.heading) {
    parts.push('h' + entry.heading.toLowerCase());
  }

  // Navigation links — emit in a consistent order
  for (const cmd of NAV_LINK_COMMANDS) {
    if (entry.links[cmd] !== undefined) {
      parts.push(cmd + String(entry.links[cmd]));
    }
  }

  // Home marker
  if (entry.isHome) {
    parts.push('y');
  }

  // External URL
  if (entry.externalUrl) {
    let xPart = 'x';
    if (entry.externalUrl.label && entry.externalUrl.label !== 'Info') {
      xPart += '(' + entry.externalUrl.label + ')';
    }
    xPart += '"' + entry.externalUrl.url + '"';
    parts.push(xPart);
  }

  // User-defined link
  if (entry.userDefined) {
    parts.push('=(' + entry.userDefined.label + ')' + String(entry.userDefined.targetId));
  }

  // Unsupported/Unknown tokens
  if (entry.unsupportedTokens && entry.unsupportedTokens.length > 0) {
    parts.push(...entry.unsupportedTokens);
  }

  return parts.join(' ');
}
