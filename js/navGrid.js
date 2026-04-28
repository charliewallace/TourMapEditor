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
    this._setupSecondaryBoxes();
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

  _setupSecondaryBoxes() {
    const cells = document.querySelectorAll('#secondary-links .secondary-cell');
    cells.forEach(cell => {
      const cmd = cell.dataset.command;

      // Click to navigate
      cell.addEventListener('click', () => {
        if (this.currentEntry) {
          let targetId = null;
          let effectiveCmd = cmd;
          
          if (cmd === 'door') {
             const hasO = !!this.currentEntry.links['o'];
             const hasC = !!this.currentEntry.links['c'];
             if (hasO) { targetId = this.currentEntry.links['o']; effectiveCmd = 'o'; }
             else if (hasC) { targetId = this.currentEntry.links['c']; effectiveCmd = 'c'; }
          } else if (cmd === 'custom') {
             targetId = this.currentEntry.userDefined?.targetId;
             effectiveCmd = 'custom';
          } else {
             targetId = this.currentEntry.links[cmd] || (this.currentEntry.autoLinks && this.currentEntry.autoLinks[cmd]);
          }

          if (targetId) {
            this.onNavigate(targetId, effectiveCmd);
          }
        }
      });

      // Drop target
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
        
        if (!photoId) return;
        
        // If dragged from another cell, clear the source link first
        if (sourceCmd && sourceCmd !== cmd && this.currentEntry) {
          this.onLinkChanged(sourceCmd, null);
        }
        
        if (cmd === 'door') {
           const hasO = !!this.currentEntry.links['o'];
           const hasC = !!this.currentEntry.links['c'];
           if (hasO) {
              this.onLinkChanged('o', photoId, imageName);
           } else if (hasC) {
              this.onLinkChanged('c', photoId, imageName);
           } else {
              // Prompt user to designate current state
              if (confirm("Is the currently displayed center photo a CLOSED door?\n\nOK = Center is CLOSED, dropped image is OPEN\nCancel = Center is OPEN, dropped image is CLOSED")) {
                 this.onLinkChanged('o', photoId, imageName); // current is closed, dropped is open
              } else {
                 this.onLinkChanged('c', photoId, imageName); // current is open, dropped is closed
              }
           }
        } else if (cmd === 'custom') {
           let label = prompt("Enter a short label for this custom link (max 25 characters):", "Target");
           if (label !== null) {
              label = label.trim();
              if (label.length === 0) {
                 alert("Custom link label cannot be empty.");
                 return;
              }
              if (label.length > 25) {
                 label = label.substring(0, 25);
              }
              this.onLinkChanged('custom', photoId, imageName, label);
           }
        } else {
           this.onLinkChanged(cmd, photoId, imageName);
        }
      });

      // Drag out
      cell.addEventListener('dragstart', (e) => {
        let targetId = null;
        let sourceCmd = cmd;
        if (cmd === 'door') {
             const hasO = !!this.currentEntry.links['o'];
             const hasC = !!this.currentEntry.links['c'];
             if (hasO) { targetId = this.currentEntry.links['o']; sourceCmd = 'o'; }
             else if (hasC) { targetId = this.currentEntry.links['c']; sourceCmd = 'c'; }
        } else if (cmd === 'custom') {
             targetId = this.currentEntry.userDefined?.targetId;
             sourceCmd = 'custom';
        } else {
             targetId = this.currentEntry?.links[cmd];
        }

        if (targetId) {
          e.dataTransfer.setData('application/photo-id', String(targetId));
          e.dataTransfer.setData('application/source-command', sourceCmd);
          e.dataTransfer.effectAllowed = 'link';
          cell.classList.add('dragging');
        } else {
          e.preventDefault();
        }
      });
      cell.addEventListener('dragend', () => cell.classList.remove('dragging'));

      // Context menu
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!this.currentEntry) return;
        
        let effectiveCmd = cmd;
        let hasLink = false;
        
        if (cmd === 'door') {
           if (this.currentEntry.links['o']) { effectiveCmd = 'o'; hasLink = true; }
           else if (this.currentEntry.links['c']) { effectiveCmd = 'c'; hasLink = true; }
        } else if (cmd === 'custom') {
           hasLink = false; // No context menu for custom link yet
        } else {
           if (this.currentEntry.links[cmd]) hasLink = true;
        }
        
        if (hasLink) {
          this._showContextMenu(e.clientX, e.clientY, effectiveCmd);
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

    // Update secondary boxes
    const secondaryCells = document.querySelectorAll('#secondary-links .secondary-cell');
    secondaryCells.forEach(cell => {
      const cmd = cell.dataset.command;
      const imageDiv = cell.querySelector('.cell-image');
      const labelSpan = cell.querySelector('.cell-label');
      
      imageDiv.innerHTML = '';
      cell.classList.remove('has-image');
      cell.removeAttribute('data-door-state');
      const oldBadge = cell.querySelector('.cell-id-badge');
      if (oldBadge) oldBadge.remove();

      let targetId = null;
      let isAuto = false;
      let effectiveCmd = cmd;
      
      if (cmd === 'door') {
         const hasO = !!entry.links['o'];
         const hasC = !!entry.links['c'];
         if (hasO) { 
           targetId = entry.links['o']; 
           effectiveCmd = 'o'; 
           labelSpan.textContent = '🚪 Open';
           cell.setAttribute('data-door-state', 'closed'); // we are closed, showing open target
         } else if (hasC) { 
           targetId = entry.links['c']; 
           effectiveCmd = 'c'; 
           labelSpan.textContent = '🔒 Close';
           cell.setAttribute('data-door-state', 'open'); // we are open, showing closed target
         } else {
           labelSpan.textContent = '🚪 Door';
         }
      } else if (cmd === 'custom') {
         if (entry.userDefined && entry.userDefined.targetId) {
           targetId = entry.userDefined.targetId;
           labelSpan.textContent = `🔗 ${entry.userDefined.label || 'Custom'}`;
           effectiveCmd = 'custom';
         } else {
           labelSpan.textContent = '🔗 Custom';
         }
      } else {
         targetId = entry.links[cmd];
         if (!targetId && entry.autoLinks && entry.autoLinks[cmd]) {
           targetId = entry.autoLinks[cmd];
           isAuto = true;
         }
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
          badge.title = `Auto-derived link (not stored in record) — the tour engine computes this at playback. To make it explicit, drag the image to this box.`;
        } else {
          badge.textContent = targetId;
        }
        cell.appendChild(badge);
      } else {
        imageDiv.innerHTML = `<div class="cell-placeholder">${effectiveCmd}</div>`;
      }
    });

    // --- Restricted Cell Overlays (Doors & Zoom) ---
    // When the current entry is the CLOSED member of a door pair, Forward/Zoom are blocked.
    // When the current entry is a Zoom State, Left/Right/Forward/Turn are blocked.
    const DOOR_OPEN_ONLY_CMDS = ['f', 'z'];
    const ZOOM_BLOCKED_CMDS = ['l', 'r', 'f', 'a'];
    const isClosed = this._isClosedDoorEntry(entry);
    const isZoom = this._isZoomState(entry);
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
      } else if (isZoom && ZOOM_BLOCKED_CMDS.includes(cmd)) {
        cell.classList.add('door-locked');
        const overlay = document.createElement('div');
        overlay.className = 'door-locked-overlay';
        overlay.innerHTML = `
          <span class="lock-icon">🚫</span>
          <span class="lock-msg">Not allowed<br>in zoom state</span>
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
    const secondaryCells = document.querySelectorAll('#secondary-links .secondary-cell');
    secondaryCells.forEach(cell => {
      const cmd = cell.dataset.command;
      const imageDiv = cell.querySelector('.cell-image');
      const labelSpan = cell.querySelector('.cell-label');
      
      imageDiv.innerHTML = `<div class="cell-placeholder">${cmd}</div>`;
      cell.classList.remove('has-image');
      cell.removeAttribute('data-door-state');
      const badge = cell.querySelector('.cell-id-badge');
      if (badge) badge.remove();
      
      // Reset specific labels
      if (cmd === 'door') labelSpan.textContent = '🚪 Door';
      if (cmd === 'custom') labelSpan.textContent = '🔗 Custom';
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
   * Returns true if the given entry acts as a Zoom destination.
   * @param {import('./dataModel.js').MapEntry|null} entry
   * @returns {boolean}
   */
  _isZoomState(entry) {
    if (!entry || entry.type !== 'link') return false;
    return this.tourMap.entries.some(e => e.type === 'link' && e.links['z'] === entry.id);
  }

  /**
   * Updates the door-help-banner to match the current entry's door relationship.
   */
  _updateDoorBanner(entry) {
    const banner = this.doorHelpBanner;
    if (!banner) return;

    if (!entry || entry.type !== 'link') {
      banner.className = 'door-help-banner hidden';
      return;
    }

    const hasO = !!entry.links['o'];
    const hasC = !!entry.links['c'];

    if (!hasO && !hasC) {
      // Hide banner, user interacts with Door Toggle box directly
      banner.className = 'door-help-banner hidden';

    } else if (hasO) {
      // Closed door
      const openSibling = this.tourMap.findById(entry.links['o']);
      const fullyLinked = openSibling && openSibling.links['c'] === entry.id;

      if (!fullyLinked) {
        // Hide pulse behavior, just keep hidden or show a minor warning
        banner.className = 'door-help-banner hidden';
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

  // Remove the old pulsing hint method since we're not using chips anymore
  _showNeedsOpenState(entry) {}

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
