/**
 * rawLineEditor.js — Bottom bar: displays and allows editing of the
 * raw text for the selected link line. Changes are parsed back into the model.
 */

import { parseMapFile, parseLinkLine } from './mapFileParser.js';
import { serializeLinkLine } from './mapFileSerializer.js';

export class RawLineEditor {
  /**
   * @param {import('./dataModel.js').TourMap} tourMap
   * @param {Function} onLineEdited - callback() when the raw line is edited
   */
  constructor(tourMap, onLineEdited) {
    this.tourMap = tourMap;
    this.onLineEdited = onLineEdited;
    this.currentIndex = -1;
    this._suppressUpdate = false;

    this.el = document.getElementById('raw-line-editor');

    this.el.addEventListener('input', () => {
      if (this._suppressUpdate || this.currentIndex < 0) return;
      this._pushRaw(this.el.value);
    });

    // Commit on Enter
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._pushRaw(this.el.value);
      }
    });
  }

  /**
   * Update the editor to show a given entry's raw text.
   * @param {number} index
   */
  update(index) {
    this.currentIndex = index;
    this._suppressUpdate = true;

    const entry = this.tourMap.entries[index];
    if (!entry) {
      this.el.value = '';
      this.el.placeholder = 'Select a line to view its raw text';
      this._suppressUpdate = false;
      return;
    }

    // Only update if not already focused by the user (to avoid cursor jumps and breaking undo)
    if (document.activeElement !== this.el) {
      if (entry.type === 'link') {
        // Prefer the original raw text to avoid re-ordering tokens, unless it's been cleared
        this.el.value = entry.raw || serializeLinkLine(entry);
      } else {
        this.el.value = entry.raw || '';
      }
    }

    this.el.placeholder = '';
    this._suppressUpdate = false;
  }

  /**
   * Push a raw text change back into the model.
   * @param {string} rawText
   */
  _pushRaw(rawText) {
    const entry = this.tourMap.entries[this.currentIndex];
    if (!entry) return;

    if (entry.type === 'link') {
      const trimmed = rawText.trim();
      if (!trimmed) return;

      const parsed = parseLinkLine(trimmed);
      
      // Copy parsed fields onto the existing entry
      entry.id = parsed.id;
      entry.heading = parsed.heading;
      entry.links = parsed.links;
      entry.customImage = parsed.customImage;
      entry.isHome = parsed.isHome;
      entry.externalUrl = parsed.externalUrl;
      entry.userDefined = parsed.userDefined;
      entry.unsupportedTokens = parsed.unsupportedTokens || [];
      entry.raw = trimmed;
    } else {
      entry.raw = rawText;
    }

    this.onLineEdited();
  }
}
