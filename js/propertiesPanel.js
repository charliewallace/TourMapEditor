/**
 * propertiesPanel.js — Properties form for the currently selected link entry:
 * heading, locale, description, custom image, user-defined links, home flag.
 */

import { HEADINGS } from './dataModel.js';

export class PropertiesPanel {
  /**
   * @param {import('./dataModel.js').TourMap} tourMap
   * @param {Function} onEntryChanged - callback() when properties are edited
   */
  constructor(tourMap, onEntryChanged) {
    this.tourMap = tourMap;
    this.onEntryChanged = onEntryChanged;
    this.currentIndex = -1;
    this._suppressUpdate = false;

    // Bind elements
    this.elLocaleId = document.getElementById('prop-locale-id');
    this.elLocaleText = document.getElementById('prop-locale-text');
    this.elHeading = document.getElementById('prop-heading');
    this.elDescription = document.getElementById('prop-description');
    this.elVerbose = document.getElementById('prop-verbose');
    this.elCustomImage = document.getElementById('prop-custom-image');
    this.elCustomLabel = document.getElementById('prop-custom-label');
    this.elCustomTarget = document.getElementById('prop-custom-target');
    this.elHome = document.getElementById('prop-home');
    
    // Sync elements
    this.elSyncBadge = document.getElementById('prop-sync-badge');
    this.elStrictGroup = document.getElementById('prop-strict-group');
    this.elStrictSync = document.getElementById('prop-strict-sync');

    // Wire change events
    this.elLocaleId.addEventListener('change', () => this._pushChanges());
    this.elLocaleText.addEventListener('input', () => this._pushChanges());
    this.elHeading.addEventListener('change', () => this._pushChanges());
    this.elDescription.addEventListener('input', () => this._pushChanges());
    this.elVerbose.addEventListener('input', () => this._pushChanges());
    this.elCustomImage.addEventListener('input', () => this._pushChanges());
    this.elCustomLabel.addEventListener('input', () => this._pushChanges());
    this.elCustomTarget.addEventListener('input', () => this._pushChanges());
    this.elHome.addEventListener('change', () => this._pushChanges());
    this.elStrictSync.addEventListener('change', () => this._pushChanges());
  }

  /**
   * Update the panel to display a given entry.
   * @param {number} index - entry index in tourMap.entries
   */
  update(index) {
    this.currentIndex = index;
    const entry = this.tourMap.entries[index];

    this._suppressUpdate = true;

    if (!entry || (entry.type !== 'link' && entry.type !== 'locale')) {
      this._clearAll();
      this._setDisabled(true);
      this._suppressUpdate = false;
      return;
    }

    if (entry.type === 'locale') {
      this._setDisabled(true);
      this.elLocaleId.disabled = false;
      this.elLocaleText.disabled = false;

      this._setIfNotFocused(this.elLocaleId, entry.localeId ?? '');
      this._setIfNotFocused(this.elLocaleText, entry.localeText || '');
      
      this.elHeading.value = '';
      this.elDescription.value = '';
      this.elVerbose.value = '';
      this.elCustomImage.value = '';
      this.elCustomLabel.value = '';
      this.elCustomTarget.value = '';
      this.elHome.checked = false;
      this.elSyncBadge.classList.add('hidden');
      this.elStrictGroup.classList.add('hidden');
    } else {
      this._setDisabled(false);

      this._setIfNotFocused(this.elLocaleId, entry.localeId ?? '');
      this._setIfNotFocused(this.elLocaleText, entry.localeDescription || '');
      
      this.elHeading.value = entry.heading || '';
      this._setIfNotFocused(this.elDescription, entry.description || '');
      this._setIfNotFocused(this.elVerbose, entry.verboseDescription || '');
      this._setIfNotFocused(this.elCustomImage, entry.customImage || '');
      this._setIfNotFocused(this.elCustomLabel, entry.userDefined?.label || '');
      this._setIfNotFocused(this.elCustomTarget, entry.userDefined?.targetId || '');
      this.elHome.checked = entry.isHome || false;

      // Sync Group Logic
      const syncGroups = this.tourMap.getSyncGroupsForNode(entry.id);
      const seqGroup = syncGroups.find(g => g.type === 'sequence');
      
      if (syncGroups.length > 0) {
         this.elSyncBadge.classList.remove('hidden');
         if (seqGroup) {
            this.elStrictGroup.classList.remove('hidden');
            this.elStrictSync.checked = !seqGroup.isLoose;
         } else {
            this.elStrictGroup.classList.add('hidden');
         }
      } else {
         this.elSyncBadge.classList.add('hidden');
         this.elStrictGroup.classList.add('hidden');
      }
    }

    this._suppressUpdate = false;
  }

  /**
   * Sets a field value only if it doesn't currently have focus,
   * preventing cursor jumps and focus loss during typing.
   */
  _setIfNotFocused(el, value) {
    if (document.activeElement !== el) {
      el.value = value;
    }
  }

  _clearAll() {
    this.elLocaleId.value = '';
    this.elLocaleText.value = '';
    this.elHeading.value = '';
    this.elDescription.value = '';
    this.elVerbose.value = '';
    this.elCustomImage.value = '';
    this.elCustomLabel.value = '';
    this.elCustomTarget.value = '';
    this.elHome.checked = false;
  }

  _setDisabled(disabled) {
    const focused = document.activeElement;
    if (this.elLocaleId !== focused) this.elLocaleId.disabled = disabled;
    if (this.elLocaleText !== focused) this.elLocaleText.disabled = disabled;
    if (this.elHeading !== focused) this.elHeading.disabled = disabled;
    if (this.elDescription !== focused) this.elDescription.disabled = disabled;
    if (this.elVerbose !== focused) this.elVerbose.disabled = disabled;
    if (this.elCustomImage !== focused) this.elCustomImage.disabled = disabled;
    if (this.elCustomLabel !== focused) this.elCustomLabel.disabled = disabled;
    if (this.elCustomTarget !== focused) this.elCustomTarget.disabled = disabled;
    if (this.elHome !== focused) this.elHome.disabled = disabled;
  }

  _pushChanges() {
    if (this._suppressUpdate || this.currentIndex < 0) return;

    const entry = this.tourMap.entries[this.currentIndex];
    if (!entry || (entry.type !== 'link' && entry.type !== 'locale')) return;

    const localeId = this.elLocaleId.value !== '' ? parseInt(this.elLocaleId.value, 10) : null;
    const localeTextVal = this.elLocaleText.value;

    if (entry.type === 'locale') {
      entry.localeId = isNaN(localeId) ? null : localeId;
      // Sync the description text to all entries with this locale ID
      this.tourMap.entries.forEach(e => {
        if (e.localeId === entry.localeId) {
          e.localeDescription = localeTextVal;
          if (e.type === 'locale') e.localeText = localeTextVal;
        }
      });
    } else {
      entry.localeId = isNaN(localeId) ? null : localeId;
      entry.localeDescription = localeTextVal;
      entry.heading = this.elHeading.value || null;
      entry.description = this.elDescription.value;
      entry.verboseDescription = this.elVerbose.value;
      entry.customImage = this.elCustomImage.value || null;
      
      const customLabel = this.elCustomLabel.value;
      const customTarget = this.elCustomTarget.value;
      if (customLabel || customTarget) {
        entry.userDefined = { label: customLabel, targetId: customTarget };
      } else {
        entry.userDefined = null;
      }

      entry.isHome = this.elHome.checked;
      
      // Update Sync mode if sequence
      const syncGroups = this.tourMap.getSyncGroupsForNode(entry.id);
      const seqGroups = syncGroups.filter(g => g.type === 'sequence');
      if (seqGroups.length > 0) {
         const isStrict = this.elStrictSync.checked;
         const applyLoose = (e) => {
            const hasLoose = e.unsupportedTokens.includes('*loose');
            if (isStrict && hasLoose) {
               e.unsupportedTokens = e.unsupportedTokens.filter(t => t !== '*loose');
               e.markModified();
            } else if (!isStrict && !hasLoose) {
               e.unsupportedTokens.push('*loose');
               e.markModified();
            }
         };
         
         // Apply to self and siblings
         applyLoose(entry);
         seqGroups.forEach(g => {
            g.siblings.forEach(sibId => {
               const s = this.tourMap.findById(sibId);
               if (s) applyLoose(s);
            });
         });
      }

      entry.markModified();
      
      // Update the master locale header if applicable, and all siblings
      if (entry.localeId !== null && entry.localeId !== -1) {
        this.tourMap.entries.forEach(e => {
          if (e.localeId === entry.localeId) {
            e.localeDescription = localeTextVal;
            if (e.type === 'locale') e.localeText = localeTextVal;
          }
        });
      }
    }

    this.onEntryChanged();
  }
}
