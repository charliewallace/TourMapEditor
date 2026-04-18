/**
 * lineList.js — Left sidebar: renders the list of map entries,
 * handles selection and drag-to-reorder.
 */

import { COMMAND_LABELS } from './dataModel.js';

export class LineList {
  /**
   * @param {HTMLElement} container - the #line-list element
   * @param {import('./dataModel.js').TourMap} tourMap
   * @param {Function} onSelect - callback(index)
   */
  constructor(container, tourMap, onSelect) {
    this.container = container;
    this.tourMap = tourMap;
    this.onSelect = onSelect;
    this.selectedIndex = -1;
    this.filterText = '';

    // Search
    const searchInput = document.getElementById('line-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.filterText = e.target.value.toLowerCase();
        this.render();
      });
    }
  }

  render() {
    this.container.innerHTML = '';

    if (this.tourMap.entries.length === 0) {
      this.container.innerHTML = '<div class="empty-state">Open a map file to begin</div>';
      return;
    }

    this.tourMap.entries.forEach((entry, index) => {
      // Skip description and blank entries from the list display
      if (entry.type === 'description' || entry.type === 'blank') return;

      const label = this._getLabel(entry);
      // Filter
      if (this.filterText && !label.toLowerCase().includes(this.filterText)) return;

      const item = document.createElement('div');
      item.className = `line-item type-${entry.type}`;
      if (index === this.selectedIndex) item.classList.add('selected');

      item.draggable = true;
      item.dataset.index = index;

      const badge = document.createElement('span');
      badge.className = 'line-badge';
      badge.textContent = this._getBadge(entry);
      item.appendChild(badge);

      const labelSpan = document.createElement('span');
      labelSpan.className = 'line-label';
      labelSpan.textContent = label;
      item.appendChild(labelSpan);

      if (entry.type === 'link' && entry.isHome) {
        const home = document.createElement('span');
        home.className = 'home-marker';
        home.textContent = '🏠';
        home.title = 'Home view';
        item.appendChild(home);
      }

      item.addEventListener('click', () => {
        this.select(index);
      });

      // Drag events for reordering
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', String(index));
        e.dataTransfer.effectAllowed = 'move';
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (!isNaN(fromIndex) && fromIndex !== index) {
          this.tourMap.moveEntry(fromIndex, index);
          this.selectedIndex = index;
          this.render();
          this.onSelect(index);
        }
      });

      this.container.appendChild(item);
    });
  }

  select(index) {
    this.selectedIndex = index;
    this.render();
    this.onSelect(index);
  }

  /**
   * Scroll the container to reveal the item at the given index.
   */
  scrollToIndex(index) {
    const item = this.container.querySelector(`.line-item[data-index="${index}"]`);
    if (item) {
      item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  _getBadge(entry) {
    switch (entry.type) {
      case 'link': return String(entry.id ?? '?');
      case 'locale': return '$' + (entry.localeId ?? '');
      case 'comment': return '#';
      case 'title': return '!';
      case 'prefix': return '+';
      default: return '·';
    }
  }

  _getLabel(entry) {
    switch (entry.type) {
      case 'link': {
        const parts = [];
        if (entry.heading) parts.push(entry.heading);
        const linkCount = Object.keys(entry.links).length;
        if (linkCount > 0) parts.push(`${linkCount} links`);
        if (entry.description && entry.description !== entry.localeDescription) {
          const desc = entry.description.replace(entry.localeDescription, '').trim();
          if (desc) parts.push(desc);
        }
        return parts.join(' · ') || 'Link line';
      }
      case 'locale':
        return entry.localeText || 'Locale';
      case 'comment':
        return entry.raw.substring(1).trim() || 'Comment';
      case 'title':
        return entry.raw.substring(1).trim() || 'Title';
      case 'prefix':
        return entry.raw.substring(1).trim() || 'Prefix';
      default:
        return entry.raw || '';
    }
  }
}
