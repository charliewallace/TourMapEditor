/**
 * navGrid.js — Center panel: renders the 3×3 navigation grid with image
 * thumbnails for directional links, handles drag-drop link assignment,
 * click-to-navigate, and context menu for clearing links.
 */

import { COMMAND_LABELS, NAV_LINK_COMMANDS } from './dataModel.js';

/** The 9 grid commands in display order */
const GRID_COMMANDS = ['u', 'f', 'z', 'l', 'primary', 'r', 'd', 'b', 'a'];
/** The secondary (chip) commands */
const CHIP_COMMANDS = ['o', 'c', 'n', 'p', 'q', 'w', 'e', 'j'];

export class NavGrid {
  /**
   * @param {import('./dataModel.js').TourMap} tourMap
   * @param {Function} onNavigate - callback(photoId) when user clicks a populated cell
   * @param {Function} onLinkChanged - callback(command, targetId|null) when a link is set/cleared
   * @param {Function} getImageUrl - callback(photoId) => URL | null
   * @param {Function} onHeadingClick - callback(photoId, currentHeading)
   */
  constructor(tourMap, onNavigate, onLinkChanged, getImageUrl, onHeadingClick) {
    this.tourMap = tourMap;
    this.onNavigate = onNavigate;
    this.onLinkChanged = onLinkChanged;
    this.getImageUrl = getImageUrl;
    this.onHeadingClick = onHeadingClick;
    this.onSetAsClosedDoor = null; // optional callback: () => void
    this.currentEntry = null;
    this.doorHelpBanner = document.getElementById('door-help-banner');
    this._setupCells();
    this._setupChips();
  }

  _setupCells() {
    const cells = document.querySelectorAll('#nav-grid .nav-cell');
    cells.forEach(cell => {
      const cmd = cell.dataset.command;

      // Click to navigate
      cell.addEventListener('click', () => {
        if (cmd === 'primary') return;
        if (this.currentEntry) {
          const targetId = this.currentEntry.links[cmd] || (this.currentEntry.autoLinks && this.currentEntry.autoLinks[cmd]);
          if (targetId) {
            this.onNavigate(targetId, cmd);
          }
        }
      });

      // Drop target for images
      cell.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'link';
        cell.classList.add('drop-target');
      });
      cell.addEventListener('dragleave', () => {
        cell.classList.remove('drop-target');
      });
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('drop-target');
        const photoId = e.dataTransfer.getData('application/photo-id');
        const imageName = e.dataTransfer.getData('application/image-name');
        const sourceCmd = e.dataTransfer.getData('application/source-command');
        
        if (cmd === 'primary') {
           if (this.onPrimaryDrop) this.onPrimaryDrop(photoId, imageName);
           return;
        }
        
        if (photoId) {
          // If dragged from another grid cell, clear the source link first
          if (sourceCmd && sourceCmd !== cmd && this.currentEntry) {
            this.onLinkChanged(sourceCmd, null);
          }
          this.onLinkChanged(cmd, photoId, imageName);
        }
      });

      // Allow dragging images OUT of cells to move them
      cell.addEventListener('dragstart', (e) => {
        if (cmd === 'primary') {
           if (this.currentEntry) {
             e.dataTransfer.setData('application/photo-id', String(this.currentEntry.id));
             e.dataTransfer.effectAllowed = 'link';
             cell.classList.add('dragging');
           }
           return;
        }
        const targetId = this.currentEntry?.links[cmd];
        if (targetId) {
          e.dataTransfer.setData('application/photo-id', String(targetId));
          e.dataTransfer.setData('application/source-command', cmd);
          e.dataTransfer.effectAllowed = 'link';
          cell.classList.add('dragging');
        }
      });
      cell.addEventListener('dragend', () => cell.classList.remove('dragging'));

      // Right-click to clear
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (cmd === 'primary') return;
        if (this.currentEntry && this.currentEntry.links[cmd]) {
          this._showContextMenu(e.clientX, e.clientY, cmd);
        }
      });
    });
  }

  _setupChips() {
    const chips = document.querySelectorAll('#secondary-links .link-chip');
    chips.forEach(chip => {
      const cmd = chip.dataset.command;

      chip.addEventListener('click', () => {
        if (this.currentEntry) {
          const targetId = this.currentEntry.links[cmd] || (this.currentEntry.autoLinks && this.currentEntry.autoLinks[cmd]);
          if (targetId) {
            this.onNavigate(targetId, cmd);
          }
        }
      });

      // Drop target
      chip.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'link';
        chip.classList.add('drop-target');
      });
      chip.addEventListener('dragleave', () => {
        chip.classList.remove('drop-target');
      });
      chip.addEventListener('drop', (e) => {
        e.preventDefault();
        chip.classList.remove('drop-target');
        const photoId = e.dataTransfer.getData('application/photo-id');
        const imageName = e.dataTransfer.getData('application/image-name');
        if (photoId) {
          this.onLinkChanged(cmd, photoId, imageName);
        }
      });

      chip.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.currentEntry && this.currentEntry.links[cmd]) {
          this._showContextMenu(e.clientX, e.clientY, cmd);
        }
      });
    });
  }

  /**
   * Update the grid to show a given entry.
   * @param {import('./dataModel.js').MapEntry|null} entry
   */
  update(entry) {
    this.currentEntry = entry;
    const titleEl = document.getElementById('nav-grid-title');
    const subtitleEl = document.getElementById('nav-grid-subtitle');

    if (!entry || entry.type !== 'link') {
      titleEl.textContent = 'Navigation Grid';
      subtitleEl.textContent = '';
      this._clearAll();
      return;
    }

    titleEl.textContent = `Photo #${entry.id}`;
    const parts = [];
    if (entry.heading) parts.push(`Heading: ${entry.heading}`);
    if (entry.localeDescription) parts.push(entry.localeDescription);
    subtitleEl.textContent = parts.join(' · ');

    // Update grid cells
    const cells = document.querySelectorAll('#nav-grid .nav-cell');
    cells.forEach(cell => {
      const cmd = cell.dataset.command;
      const imageDiv = cell.querySelector('.cell-image');

      // Remove old content
      imageDiv.innerHTML = '';
      cell.classList.remove('has-image');

      // Remove old ID badge and heading badge
      const oldBadge = cell.querySelector('.cell-id-badge');
      if (oldBadge) oldBadge.remove();
      const oldHBadge = cell.querySelector('.cell-heading-badge');
      if (oldHBadge) oldHBadge.remove();

      if (cmd === 'primary') {
        // Show the primary image
        const url = this.getImageUrl(entry.id);
        if (url) {
          const img = document.createElement('img');
          img.src = url;
          img.alt = `Photo ${entry.id}`;
          img.loading = 'lazy';
          imageDiv.appendChild(img);
          cell.classList.add('has-image');
        } else {
          imageDiv.innerHTML = `<div class="cell-placeholder">${entry.id}</div>`;
        }
      } else {
        let isAuto = false;
        let targetId = entry.links[cmd];
        if (!targetId && entry.autoLinks && entry.autoLinks[cmd]) {
          targetId = entry.autoLinks[cmd];
          isAuto = true;
        }

        if (targetId) {
          const url = this.getImageUrl(targetId);
          if (url) {
            const img = document.createElement('img');
            img.src = url;
            img.alt = `Photo ${targetId}`;
            img.loading = 'lazy';
            imageDiv.appendChild(img);
            cell.classList.add('has-image');
          } else {
            imageDiv.innerHTML = `<div class="cell-placeholder">${targetId}</div>`;
            cell.classList.add('has-image');
          }
          // ID badge
          const badge = document.createElement('span');
          badge.className = 'cell-id-badge';
          if (isAuto) {
            badge.style.background = 'rgba(88, 166, 255, 0.9)'; // Use var(--accent) dynamically
            badge.style.color = '#000';
            badge.textContent = `auto: ${targetId}`;
            badge.title = `This link is automatically derived from compass headings — it is NOT stored in the record. The tour engine computes it the same way at playback, so it works correctly. To store it explicitly, drag the image from this cell back to the same slot.`;
          } else {
            badge.textContent = targetId;
          }
          cell.appendChild(badge);

          // Heading badge for directional links
          const targetEntry = this.tourMap.findById(targetId);
          if (targetEntry) {
            const hBadge = document.createElement('span');
            hBadge.className = 'cell-heading-badge';
            hBadge.textContent = targetEntry.heading || '??';
            hBadge.title = targetEntry.heading ? "Click to change heading" : "Click to set heading";
            hBadge.addEventListener('click', (e) => {
              e.stopPropagation();
              if (this.onHeadingClick) this.onHeadingClick(targetId, targetEntry.heading);
            });
            cell.appendChild(hBadge);
          }
        } else {
          imageDiv.innerHTML = `<div class="cell-placeholder">${cmd}</div>`;
        }
      }

      // Add heading badge to primary cell
      if (cmd === 'primary') {
        const hBadge = document.createElement('span');
        hBadge.className = 'cell-heading-badge';
        hBadge.textContent = entry.heading || '??';
        hBadge.title = entry.heading ? "Click to change heading" : "Click to set heading";
        hBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.onHeadingClick) this.onHeadingClick(entry.id, entry.heading);
        });
        cell.appendChild(hBadge);
      }
    });

    // Update chips
    const chips = document.querySelectorAll('#secondary-links .link-chip');
    chips.forEach(chip => {
      const cmd = chip.dataset.command;
      const targetSpan = chip.querySelector('.chip-target');
      
      let targetId = entry.links[cmd];
      let isAuto = false;
      if (!targetId && entry.autoLinks && entry.autoLinks[cmd]) {
        targetId = entry.autoLinks[cmd];
        isAuto = true;
      }

      if (targetId) {
        targetSpan.textContent = isAuto ? ` auto: #${targetId}` : ` #${targetId}`;
        chip.classList.add('active');
        if (isAuto) {
          chip.style.borderColor = 'var(--accent)'; // Highlight auto chips
          chip.title = `Auto-derived link (not stored in record) — the tour engine computes this at playback. To make it explicit, drag the image to this chip.`;
        } else {
          chip.title = '';
        }
      } else {
        targetSpan.textContent = '';
        chip.classList.remove('active');
        chip.style.borderColor = '';
        chip.title = '';
      }
    });

    // Update User-Defined Custom Link (=(Label)Target)
    const customContainer = document.getElementById('custom-link-container');
    customContainer.innerHTML = '';
    
    if (entry.userDefined && entry.userDefined.targetId) {
      const chip = document.createElement('button');
      chip.className = 'link-chip active custom-link';
      chip.style.borderStyle = 'dashed'; // Distinctive style for user links
      
      const labelText = entry.userDefined.label || 'Custom';
      chip.innerHTML = `<span class="chip-icon">🔗</span> ${labelText}<span class="chip-target"> #${entry.userDefined.targetId}</span>`;
      
      chip.addEventListener('click', () => {
        this.onNavigate(entry.userDefined.targetId, 'custom');
      });
      
      customContainer.appendChild(chip);
    }

    // --- Door-Locked Cell Overlay ---
    // When the current entry is the CLOSED member of a door pair, the Forward (f)
    // and Zoom (z) cells should visually block drops and show a lock indicator.
    const DOOR_OPEN_ONLY_CMDS = ['f', 'z'];
    const isClosed = this._isClosedDoorEntry(entry);
    const cells2 = document.querySelectorAll('#nav-grid .nav-cell');
    cells2.forEach(cell => {
      const cmd = cell.dataset.command;
      // First, remove any stale lock state from previous renders
      cell.classList.remove('door-locked');
      const staleOverlay = cell.querySelector('.door-locked-overlay');
      if (staleOverlay) staleOverlay.remove();

      if (isClosed && DOOR_OPEN_ONLY_CMDS.includes(cmd)) {
        cell.classList.add('door-locked');
        const overlay = document.createElement('div');
        overlay.className = 'door-locked-overlay';
        overlay.innerHTML = `
          <span class="lock-icon">🔒</span>
          <span class="lock-msg">Not allowed<br>when door is closed</span>
        `;
        cell.appendChild(overlay);
      }
    });

    // Update the door-help banner
    this._updateDoorBanner(entry);
  }

  _clearAll() {
    const cells = document.querySelectorAll('#nav-grid .nav-cell');
    cells.forEach(cell => {
      const cmd = cell.dataset.command;
      const imageDiv = cell.querySelector('.cell-image');
      imageDiv.innerHTML = `<div class="cell-placeholder">${cmd === 'primary' ? '●' : cmd}</div>`;
      cell.classList.remove('has-image', 'door-locked');
      const badge = cell.querySelector('.cell-id-badge');
      if (badge) badge.remove();
      const lockOverlay = cell.querySelector('.door-locked-overlay');
      if (lockOverlay) lockOverlay.remove();
    });
    const chips = document.querySelectorAll('#secondary-links .link-chip');
    chips.forEach(chip => {
      chip.querySelector('.chip-target').textContent = '';
      chip.classList.remove('active', 'guidance-pulse');
    });
    if (this.doorHelpBanner) this.doorHelpBanner.className = 'door-help-banner hidden';
  }

  /**
   * Returns true if the given entry is the CLOSED member of a door pair.
   * Closed member = has an 'o' (open) link, and the open sibling reciprocally
   * points back with a 'c' (close) link.
   * @param {import('./dataModel.js').MapEntry|null} entry
   * @returns {boolean}
   */
  _isClosedDoorEntry(entry) {
    if (!entry || !entry.links) return false;
    const openTargetId = entry.links['o'];
    if (!openTargetId) return false;
    const openSibling = this.tourMap.findById(openTargetId);
    return !!(openSibling && openSibling.links['c'] === entry.id);
  }

  /**
   * Updates the door-help-banner to match the current entry's door relationship.
   *
   * States:
   *  - 'state-none'        : plain image, not yet part of any door pair
   *    → show "Set as Closed Door" button
   *  - 'state-needs-open'  : closed door with no linked open member yet
   *    → pulsing hint to drag open-door image to the Open chip
   *  - 'state-is-closed'   : closed door, fully linked
   *    → informational amber label
   *  - 'state-is-open'     : open door
   *    → informational green label
   */
  _updateDoorBanner(entry) {
    const banner = this.doorHelpBanner;
    if (!banner) return;

    // Stop any existing chip pulse
    document.querySelectorAll('#secondary-links .link-chip').forEach(c =>
      c.classList.remove('guidance-pulse')
    );

    if (!entry || entry.type !== 'link') {
      banner.className = 'door-help-banner hidden';
      return;
    }

    const hasO = !!entry.links['o'];
    const hasC = !!entry.links['c'];

    if (!hasO && !hasC) {
      // Plain image — offer to designate as closed door
      banner.className = 'door-help-banner state-none';
      banner.innerHTML = `
        <span style="opacity: 0.7;">🚪</span>
        <span style="flex: 1;">Is this image a door?</span>
        <button class="door-help-btn" id="btn-set-as-closed-door">🔒 Set as Closed Door</button>
      `;
      const btn = banner.querySelector('#btn-set-as-closed-door');
      btn.addEventListener('click', () => {
        if (this.onSetAsClosedDoor) this.onSetAsClosedDoor();
        // Switch to "needs open" state immediately to guide the next step
        this._showNeedsOpenState(entry);
      });

    } else if (hasO) {
      // Closed door — check whether the open sibling actually links back
      const openSibling = this.tourMap.findById(entry.links['o']);
      const fullyLinked = openSibling && openSibling.links['c'] === entry.id;

      if (!fullyLinked) {
        // Orphaned 'o' link — treat as needs-open
        this._showNeedsOpenState(entry);
      } else {
        // Fully linked closed door
        banner.className = 'door-help-banner state-is-closed';
        banner.innerHTML = `⚠️ Closed-door state — Forward and Zoom are disabled here. Switch to the open state to add those links.`;
      }

    } else if (hasC) {
      // Open door
      banner.className = 'door-help-banner state-is-open';
      banner.innerHTML = `✅ Open-door state — Forward and Zoom links are only active when the door is open.`;
    }
  }

  /** Shows the animated "drag to Open chip" hint and pulses the Open chip. */
  _showNeedsOpenState(entry) {
    const banner = this.doorHelpBanner;
    if (!banner) return;
    banner.className = 'door-help-banner state-needs-open';
    banner.innerHTML = `
      <span>🚪 Drag the <strong>open-door image</strong> to the <strong>Open (🔓) chip</strong> below to complete this door pair.</span>
    `;
    // Pulse the Open chip
    const openChip = document.querySelector('#secondary-links .link-chip[data-command="o"]');
    if (openChip) openChip.classList.add('guidance-pulse');
  }

  _showContextMenu(x, y, cmd) {
    // Remove existing menu
    const old = document.querySelector('.context-menu');
    if (old) old.remove();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'context-menu-item danger';
    clearBtn.textContent = `Remove ${COMMAND_LABELS[cmd] || cmd} link`;
    clearBtn.addEventListener('click', () => {
      this.onLinkChanged(cmd, null);
      menu.remove();
    });
    menu.appendChild(clearBtn);

    // Add "Convert to Door" for directional links
    if (['l', 'r', 'f', 'b', 'a', 'u', 'd', 'z'].includes(cmd)) {
      const targetId = this.currentEntry?.links[cmd];
      if (targetId) {
        const doorBtn = document.createElement('button');
        doorBtn.className = 'context-menu-item';
        doorBtn.textContent = `Convert to Door (Open)`;
        doorBtn.addEventListener('click', () => {
          // Pass to app-level door linker via the same onLinkChanged callback signature if possible, 
          // or we can just call it 'o' which we've now specialized in app.js
          this.onLinkChanged('o', targetId);
          menu.remove();
        });
        menu.appendChild(doorBtn);
      }
    }

    document.body.appendChild(menu);

    // Close on click elsewhere
    const close = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 10);
  }
}
