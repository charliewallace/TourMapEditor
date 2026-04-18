/**
 * textView.js — Full-screen text editor overlay for viewing/editing
 * the entire map file as raw text. Edits are parsed back on close.
 */

import { parseMapFile } from './mapFileParser.js';
import { serializeMapFile } from './mapFileSerializer.js';

export class TextView {
  /**
   * @param {import('./dataModel.js').TourMap} tourMap
   * @param {Function} onTextChanged - callback() when text view is closed after edits
   */
  constructor(tourMap, onTextChanged) {
    this.tourMap = tourMap;
    this.onTextChanged = onTextChanged;
    this.isOpen = false;
    this._originalText = '';

    this.overlay = document.getElementById('text-view-overlay');
    this.textarea = document.getElementById('text-view-editor');
    this.btnToggle = document.getElementById('btn-text-view');
    this.btnClose = document.getElementById('btn-close-text-view');

    this.btnToggle.addEventListener('click', () => this.toggle());
    this.btnClose.addEventListener('click', () => this.close());

    // Keyboard shortcut: Escape to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    // Serialize current model to text
    const text = serializeMapFile({
      title: this.tourMap.title,
      filenamePrefix: this.tourMap.filenamePrefix,
      entries: this.tourMap.entries
    });
    this._originalText = text;
    this.textarea.value = text;
    this.overlay.classList.remove('hidden');
    this.isOpen = true;
    this.textarea.focus();
  }

  close() {
    if (!this.isOpen) return;

    const currentText = this.textarea.value;
    this.overlay.classList.add('hidden');
    this.isOpen = false;

    // If text changed, re-parse and update the model
    if (currentText !== this._originalText) {
      const result = parseMapFile(currentText);
      this.tourMap.replaceAll(result);
      this.onTextChanged();
    }
  }
}
