/**
 * wizard.js — Onboarding flow for new tours.
 * Handles folder assessment, prefix detection, and initial mode selection.
 */

export class Wizard {
  /**
   * @param {Object} options
   * @param {Function} options.onComplete - callback(config) when wizard finishes
   * @param {Function} options.onCancel - callback() when user cancels
   */
  constructor({ onComplete, onCancel }) {
    this.onComplete = onComplete;
    this.onCancel = onCancel;
    this.currentStep = 1;
    this.detectedPrefix = '';
    this.imageCount = 0;

    this.modal = document.getElementById('wizard-modal');
    this._setupEventListeners();
  }

  /**
   * Start the wizard for a given set of images.
   * @param {string[]} filenames - list of discovered image filenames
   * @param {string} folderName - the name of the folder being opened
   */
  start(filenames, folderName) {
    this.imageCount = filenames.length;
    const detection = this._detectPrefix(filenames);
    this.detectedPrefix = detection.prefix;
    this.detectedPadding = detection.padding;
    
    // Reset UI
    this.currentStep = 1;
    this._showStep(1);
    document.getElementById('wizard-folder-path').textContent = folderName || 'Unnamed Folder';
    document.getElementById('wizard-image-count').textContent = this.imageCount;
    document.getElementById('wiz-prefix-input').value = this.detectedPrefix;
    document.getElementById('wiz-digits-input').value = this.detectedPadding;
    
    const msgEl = document.getElementById('wiz-prefix-msg');
    if (this.detectedPrefix) {
      msgEl.textContent = `✨ Auto-detected: "${this.detectedPrefix}" with ${this.detectedPadding} digits.`;
      msgEl.style.color = 'var(--success)';
    } else {
      msgEl.textContent = 'No common prefix detected.';
      msgEl.style.color = 'var(--text-tertiary)';
    }

    this.modal.classList.remove('hidden');
  }

  _setupEventListeners() {
    // Step 1 buttons
    document.getElementById('btn-wiz-next-1').onclick = () => this._goToStep(2);
    document.getElementById('btn-wiz-cancel').onclick = () => {
      this.modal.classList.add('hidden');
      this.onCancel();
    };

    // Step 2 buttons
    document.getElementById('btn-wiz-next-2').onclick = () => this._goToStep(3);
    document.getElementById('btn-wiz-prev-2').onclick = () => this._goToStep(1);

    // Step 3 (Choice)
    document.getElementById('wiz-choice-locale').onclick = () => this._finish('locale');
    document.getElementById('wiz-choice-view').onclick = () => this._finish('view');
    document.getElementById('btn-wiz-prev-3').onclick = () => this._goToStep(2);

    // Close button
    document.getElementById('btn-close-wizard').onclick = () => {
       this.modal.classList.add('hidden');
       this.onCancel();
    };
  }

  _goToStep(step) {
    this.currentStep = step;
    this._showStep(step);
  }

  _showStep(step) {
    document.querySelectorAll('.wizard-step').forEach(el => el.classList.add('hidden'));
    document.getElementById(`wizard-step-${step}`).classList.remove('hidden');
  }

  /**
   * Heuristic to detect a common prefix in filenames.
   * Focuses on files in the root folder and looks for a string followed by digits.
   */
  _detectPrefix(filenames) {
    // Filter for files in the root folder (no forward slashes)
    const rootFiles = filenames.filter(f => !f.includes('/'));
    if (rootFiles.length < 2) return { prefix: '', padding: 0 };

    const counts = new Map();
    const pattern = /^([A-Za-z_]+)(\d+)/;

    for (const name of rootFiles) {
      const match = name.match(pattern);
      if (match) {
        const prefix = match[1];
        const numPart = match[2];
        const entry = counts.get(prefix) || { count: 0, totalLen: 0 };
        entry.count++;
        entry.totalLen = Math.max(entry.totalLen, numPart.length);
        counts.set(prefix, entry);
      }
    }

    if (counts.size === 0) return { prefix: '', padding: 0 };

    // Find the most frequent prefix
    let bestPrefix = '';
    let bestPadding = 0;
    let maxCount = 0;
    for (const [prefix, entry] of counts.entries()) {
      if (entry.count > maxCount) {
        maxCount = entry.count;
        bestPrefix = prefix;
        bestPadding = entry.totalLen;
      }
    }

    // Require the prefix to match at least 50% of root files to be "detected"
    if (maxCount >= rootFiles.length * 0.5) {
      return { prefix: bestPrefix, padding: bestPadding };
    }
    
    return { prefix: '', padding: 0 };
  }

  _finish(initialMode) {
    const prefix = document.getElementById('wiz-prefix-input').value.trim();
    this.modal.classList.add('hidden');
    this.onComplete({
      prefix,
      initialMode
    });
  }
}
