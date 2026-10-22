/**
 * Style Preset Manager - Standalone GUI
 * 
 * A standalone application for managing ComfyUI-Lora-Manager-Stylepack presets
 * with preview image support, drag-and-drop reordering, and group management.
 */

// ═══════════════════════════════════════════════════════════════
// API Client
// ═══════════════════════════════════════════════════════════════

const API_BASE = '/api/lm/style-presets';

const api = {
  async listPresets() {
    try {
      const response = await fetch(API_BASE);
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch presets');
      }
      return data.presets;
    } catch (error) {
      console.error('Failed to list presets:', error);
      showToast('加载预设失败: ' + error.message, 'error');
      return [];
    }
  },

  async createPreset(preset) {
    try {
      const response = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preset),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to create preset');
      }
      return data.preset;
    } catch (error) {
      console.error('Failed to create preset:', error);
      showToast('创建预设失败: ' + error.message, 'error');
      throw error;
    }
  },

  async updatePreset(id, updates) {
    try {
      const response = await fetch(`${API_BASE}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to update preset');
      }
      return data.preset;
    } catch (error) {
      console.error('Failed to update preset:', error);
      showToast('更新预设失败: ' + error.message, 'error');
      throw error;
    }
  },

  async deletePreset(id) {
    try {
      const response = await fetch(`${API_BASE}/${id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to delete preset');
      }
    } catch (error) {
      console.error('Failed to delete preset:', error);
      showToast('删除预设失败: ' + error.message, 'error');
      throw error;
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// State Management
// ═══════════════════════════════════════════════════════════════

const state = {
  presets: [],
  filteredPresets: [],
  selectedGroup: '',
  searchQuery: '',
  editingPreset: null,
  loraList: [],
  previewImage: null,
};

// ═══════════════════════════════════════════════════════════════
// UI Helpers
// ═══════════════════════════════════════════════════════════════

function showToast(message, type = 'info') {
  // Simple toast notification
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    padding: 12px 20px;
    background-color: ${type === 'error' ? '#f56565' : type === 'success' ? '#48bb78' : '#4299e0'};
    color: white;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 10000;
    animation: slideUp 0.3s ease;
    font-size: 14px;
    max-width: 400px;
  `;
  
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function showModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'flex';
  }
}

function hideModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════════
// Data Rendering
// ═══════════════════════════════════════════════════════════════

function getAllGroups() {
  const groups = new Set();
  state.presets.forEach(preset => {
    if (preset.group) {
      groups.add(preset.group);
    }
  });
  return Array.from(groups).sort();
}

function getPresetsCountByGroup(groupName) {
  return state.presets.filter(p => (p.group || '') === groupName).length;
}

function renderGroups() {
  const groupsList = document.getElementById('groupsList');
  const groups = getAllGroups();
  
  const allCount = state.presets.length;
  let html = `
    <button class="group-item ${state.selectedGroup === '' ? 'group-item--active' : ''}" data-group="">
      <span class="group-name">全部预设</span>
      <span class="group-count">${allCount}</span>
    </button>
  `;
  
  groups.forEach(group => {
    const count = getPresetsCountByGroup(group);
    const isActive = state.selectedGroup === group;
    html += `
      <button class="group-item ${isActive ? 'group-item--active' : ''}" data-group="${escapeHtml(group)}">
        <span class="group-name">${escapeHtml(group)}</span>
        <span class="group-count">${count}</span>
      </button>
    `;
  });
  
  groupsList.innerHTML = html;
  
  // Attach event listeners
  groupsList.querySelectorAll('.group-item').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedGroup = btn.dataset.group;
      filterPresets();
      renderGroups();
      renderPresets();
    });
  });
}

function renderPresets() {
  const grid = document.getElementById('presetsGrid');
  const emptyState = document.getElementById('emptyState');
  
  if (state.filteredPresets.length === 0) {
    grid.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }
  
  emptyState.style.display = 'none';
  
  let html = '';
  state.filteredPresets.forEach(preset => {
    const loraCount = preset.loras?.length || 0;
    const hasText = preset.text && preset.text.trim();
    const previewUrl = preset.preview || '';
    
    html += `
      <div class="preset-card" data-preset-id="${preset.id}" draggable="true">
        <div class="preset-drag-handle">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>
            <circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>
          </svg>
        </div>
        <div class="preset-preview">
          ${previewUrl 
            ? `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(preset.name)}" 
                    onload="adjustPreviewHeight(this)" 
                    onerror="this.parentElement.innerHTML='<svg class=\\'preset-preview-placeholder\\' width=\\'48\\' height=\\'48\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.5\\'><path d=\\'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z\\'/></svg>'" />`
            : `<svg class="preset-preview-placeholder" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>`
          }
        </div>
        <div class="preset-body">
          <div class="preset-header">
            <h3 class="preset-title">${escapeHtml(preset.name)}</h3>
          </div>
          <div class="preset-badges">
            <span class="badge badge--lora">${loraCount} 个 LoRA</span>
            ${hasText ? '<span class="badge badge--text">含文本</span>' : ''}
          </div>
          ${preset.group ? `<div class="preset-group">${escapeHtml(preset.group)}</div>` : ''}
          ${hasText ? `<div class="preset-text-preview">${escapeHtml(preset.text)}</div>` : ''}
          <div class="preset-actions">
            <button class="btn btn-secondary btn-edit" data-id="${preset.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              编辑
            </button>
            <button class="btn btn-danger btn-delete" data-id="${preset.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              删除
            </button>
          </div>
        </div>
      </div>
    `;
  });
  
  grid.innerHTML = html;
  
  // Attach event listeners
  grid.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const preset = state.presets.find(p => p.id === id);
      if (preset) {
        openEditModal(preset);
      }
    });
  });
  
  grid.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const preset = state.presets.find(p => p.id === id);
      if (preset && confirm(`确定删除预设「${preset.name}」？此操作无法撤销。`)) {
        await api.deletePreset(id);
        showToast(`已删除预设「${preset.name}」`, 'success');
        await loadPresets();
      }
    });
  });
  
  // Drag and drop
  attachDragAndDrop();

  // Pack the cards at their real heights (images adjust this again on load).
  layoutMasonry();
}

function filterPresets() {
  let filtered = state.presets;
  
  // Filter by group
  if (state.selectedGroup) {
    filtered = filtered.filter(p => (p.group || '') === state.selectedGroup);
  }
  
  // Filter by search query
  if (state.searchQuery) {
    const query = state.searchQuery.toLowerCase();
    filtered = filtered.filter(p => 
      p.name.toLowerCase().includes(query) ||
      (p.text && p.text.toLowerCase().includes(query)) ||
      (p.group && p.group.toLowerCase().includes(query))
    );
  }
  
  state.filteredPresets = filtered;
}

function updatePresetCount() {
  const count = document.getElementById('presetCount');
  count.textContent = `${state.presets.length} 个预设`;
}

// ═══════════════════════════════════════════════════════════════
// Data Loading
// ═══════════════════════════════════════════════════════════════

async function loadPresets() {
  state.presets = await api.listPresets();
  filterPresets();
  updatePresetCount();
  renderGroups();
  renderPresets();
}

// ═══════════════════════════════════════════════════════════════
// Modal Management
// ═══════════════════════════════════════════════════════════════

function resetSaveButton() {
  const saveBtn = document.getElementById('modalSaveBtn');
  if (!saveBtn) return;
  saveBtn.disabled = false;
  saveBtn.textContent = '保存';
}

function openCreateModal() {
  state.editingPreset = null;
  state.loraList = [];
  state.previewImage = null;
  
  document.getElementById('modalTitle').textContent = '新建预设';
  document.getElementById('presetForm').reset();
  resetSaveButton();
  clearPreviewImage();
  renderLoraList();
  populateGroupSuggestions();
  
  showModal('presetModal');
}

function openEditModal(preset) {
  state.editingPreset = preset;
  state.loraList = [...(preset.loras || [])];
  state.previewImage = preset.preview || null;
  
  document.getElementById('modalTitle').textContent = '编辑预设';
  resetSaveButton();
  document.getElementById('presetName').value = preset.name;
  document.getElementById('presetGroup').value = preset.group || '';
  document.getElementById('presetText').value = preset.text || '';
  
  if (state.previewImage) {
    displayPreviewImage(state.previewImage);
  } else {
    clearPreviewImage();
  }
  
  renderLoraList();
  populateGroupSuggestions();
  
  showModal('presetModal');
}

function populateGroupSuggestions() {
  const datalist = document.getElementById('groupSuggestions');
  const groups = getAllGroups();
  datalist.innerHTML = groups.map(g => `<option value="${escapeHtml(g)}">`).join('');
}

function renderLoraList() {
  const loraListEl = document.getElementById('loraList');
  
  if (state.loraList.length === 0) {
    loraListEl.innerHTML = '<div class="lora-empty">未添加任何 LoRA</div>';
    return;
  }
  
  let html = '';
  state.loraList.forEach((lora, index) => {
    const strength = Number(lora.strength || 1).toFixed(2);
    const clipStrength = Number(lora.clipStrength || lora.strength || 1).toFixed(2);
    const strengthDisplay = strength === clipStrength 
      ? strength 
      : `${strength} / ${clipStrength}`;
    
    html += `
      <div class="lora-item ${lora.active === false ? 'lora-item--inactive' : ''}">
        <div class="lora-info">
          <div class="lora-name">${escapeHtml(lora.name)}</div>
          <div class="lora-strength">强度: ${strengthDisplay} ${lora.active === false ? '(未启用)' : ''}</div>
        </div>
        <div class="lora-actions">
          <button type="button" class="btn-icon btn-edit-lora" data-index="${index}" title="编辑">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button type="button" class="btn-icon btn-remove-lora" data-index="${index}" title="删除">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  });
  
  loraListEl.innerHTML = html;
  
  // Attach event listeners
  loraListEl.querySelectorAll('.btn-edit-lora').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index);
      openEditLoraModal(index);
    });
  });
  
  loraListEl.querySelectorAll('.btn-remove-lora').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index);
      state.loraList.splice(index, 1);
      renderLoraList();
    });
  });
}

function openAddLoraModal() {
  document.getElementById('loraForm').reset();
  document.getElementById('loraName').value = '';
  document.getElementById('loraStrength').value = '1.0';
  document.getElementById('loraClipStrength').value = '1.0';
  document.getElementById('loraActive').checked = true;
  document.getElementById('loraModalSaveBtn').textContent = '添加';
  document.getElementById('loraModalSaveBtn').onclick = handleAddLora;
  
  showModal('loraModal');
}

function openEditLoraModal(index) {
  const lora = state.loraList[index];
  document.getElementById('loraName').value = lora.name;
  document.getElementById('loraStrength').value = Number(lora.strength || 1).toFixed(2);
  document.getElementById('loraClipStrength').value = Number(lora.clipStrength || lora.strength || 1).toFixed(2);
  document.getElementById('loraActive').checked = lora.active !== false;
  document.getElementById('loraModalSaveBtn').textContent = '保存';
  document.getElementById('loraModalSaveBtn').onclick = () => handleEditLora(index);
  
  showModal('loraModal');
}

async function handleAddLora() {
  const name = document.getElementById('loraName').value.trim();
  const strength = parseFloat(document.getElementById('loraStrength').value);
  const clipStrength = parseFloat(document.getElementById('loraClipStrength').value);
  const active = document.getElementById('loraActive').checked;
  
  if (!name) {
    showToast('LoRA 名称不能为空', 'error');
    return;
  }
  
  state.loraList.push({
    name,
    strength,
    clipStrength,
    active,
    expanded: Math.abs(strength - clipStrength) > 0.01,
  });
  
  // Animate the modal close
  const modal = document.getElementById('loraModal');
  modal.style.animation = 'fadeOut 0.2s ease';
  await new Promise(resolve => setTimeout(resolve, 200));
  
  renderLoraList();
  hideModal('loraModal');
  modal.style.animation = '';
}

function handleEditLora(index) {
  const name = document.getElementById('loraName').value.trim();
  const strength = parseFloat(document.getElementById('loraStrength').value);
  const clipStrength = parseFloat(document.getElementById('loraClipStrength').value);
  const active = document.getElementById('loraActive').checked;
  
  if (!name) {
    showToast('LoRA 名称不能为空', 'error');
    return;
  }
  
  state.loraList[index] = {
    name,
    strength,
    clipStrength,
    active,
    expanded: Math.abs(strength - clipStrength) > 0.01,
  };
  
  renderLoraList();
  hideModal('loraModal');
}

// ═══════════════════════════════════════════════════════════════
// Preview Image Handling
// ═══════════════════════════════════════════════════════════════

function setupPreviewUpload() {
  const container = document.getElementById('previewContainer');
  const input = document.getElementById('presetPreview');
  const removeBtn = document.getElementById('removePreviewBtn');
  
  container.addEventListener('click', () => {
    input.click();
  });
  
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    container.classList.add('drag-over');
  });
  
  container.addEventListener('dragleave', () => {
    container.classList.remove('drag-over');
  });
  
  container.addEventListener('drop', (e) => {
    e.preventDefault();
    container.classList.remove('drag-over');
    
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handlePreviewFile(file);
    }
  });
  
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      handlePreviewFile(file);
    }
  });
  
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearPreviewImage();
  });
}

function handlePreviewFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    state.previewImage = e.target.result;
    displayPreviewImage(state.previewImage);
  };
  reader.readAsDataURL(file);
}

function displayPreviewImage(dataUrl) {
  const placeholder = document.querySelector('.preview-placeholder');
  const img = document.getElementById('previewImage');
  const removeBtn = document.getElementById('removePreviewBtn');
  
  placeholder.style.display = 'none';
  img.src = dataUrl;
  img.style.display = 'block';
  removeBtn.style.display = 'flex';
}

function clearPreviewImage() {
  const placeholder = document.querySelector('.preview-placeholder');
  const img = document.getElementById('previewImage');
  const removeBtn = document.getElementById('removePreviewBtn');
  const input = document.getElementById('presetPreview');
  
  placeholder.style.display = 'flex';
  img.style.display = 'none';
  img.src = '';
  removeBtn.style.display = 'none';
  input.value = '';
  state.previewImage = null;
}

// ═══════════════════════════════════════════════════════════════
// Form Submission
// ═══════════════════════════════════════════════════════════════

async function handlePresetSubmit(e) {
  e.preventDefault();
  
  const name = document.getElementById('presetName').value.trim();
  const group = document.getElementById('presetGroup').value.trim();
  const text = document.getElementById('presetText').value;
  
  if (!name) {
    showToast('预设名称不能为空', 'error');
    return;
  }
  
  if (state.loraList.length === 0 && !text.trim()) {
    showToast('至少需要添加一个 LoRA 或填写文本', 'error');
    return;
  }
  
  const presetData = {
    name,
    group,
    text,
    loras: state.loraList,
    preview: state.previewImage,
  };
  
  // Disable the save button and show loading state
  const saveBtn = document.getElementById('modalSaveBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spinner">
      <circle cx="12" cy="12" r="10"/>
    </svg>
    保存中...
  `;
  
  try {
    if (state.editingPreset) {
      // Update existing preset
      await api.updatePreset(state.editingPreset.id, presetData);
      showToast(`已更新预设「${name}」`, 'success');
    } else {
      // Create new preset
      // Auto-assign order as the last in the group
      const groupPresets = state.presets.filter(p => (p.group || '') === group);
      const maxOrder = groupPresets.length > 0 
        ? Math.max(...groupPresets.map(p => p.order || 0))
        : -1;
      presetData.order = maxOrder + 1;
      
      await api.createPreset(presetData);
      showToast(`已创建预设「${name}」`, 'success');
    }
    
    // Fade out modal before closing
    const modal = document.getElementById('presetModal');
    modal.style.animation = 'fadeOut 0.2s ease';
    await new Promise(resolve => setTimeout(resolve, 200));
    
    hideModal('presetModal');
    modal.style.animation = '';
    
    await loadPresets();
  } catch (error) {
    // Error already shown by api client
  } finally {
    // Always restore the button, including after a successful save. Otherwise
    // the next modal keeps showing "保存中..." until the page is reloaded.
    resetSaveButton();
  }
}

// ═══════════════════════════════════════════════════════════════
// Drag and Drop Reordering
// ═══════════════════════════════════════════════════════════════

let draggedPreset = null;

function attachDragAndDrop() {
  const cards = document.querySelectorAll('.preset-card');
  
  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      const id = card.dataset.presetId;
      draggedPreset = state.filteredPresets.find(p => p.id === id);
      card.classList.add('preset-card--dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    
    card.addEventListener('dragend', () => {
      card.classList.remove('preset-card--dragging');
      draggedPreset = null;
    });
    
    card.addEventListener('dragover', (e) => {
      if (!draggedPreset) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!draggedPreset) return;
      
      const targetId = card.dataset.presetId;
      const targetPreset = state.filteredPresets.find(p => p.id === targetId);
      
      if (!targetPreset || draggedPreset.id === targetPreset.id) {
        return;
      }
      
      // Swap orders
      const tempOrder = draggedPreset.order;
      await api.updatePreset(draggedPreset.id, { order: targetPreset.order });
      await api.updatePreset(targetPreset.id, { order: tempOrder });
      
      await loadPresets();
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════════
// Masonry Layout
// ═══════════════════════════════════════════════════════════════

// Must match grid-auto-rows in preset_manager.css. Cards are laid out on
// these tiny rows, and their row span is set from their measured height.
const MASONRY_ROW_HEIGHT = 4;

let masonryFrame = 0;
let masonryResizeTimer = 0;

/**
 * Give every card just enough grid rows to hold its natural content height.
 * This replaces the old fixed "span 2" portrait rule, which stretched
 * shorter cards and left large empty areas inside them.
 */
function layoutMasonry() {
  const grid = document.getElementById('presetsGrid');
  if (!grid) return;
  
  const cards = grid.querySelectorAll('.preset-card');
  if (cards.length === 0) return;
  
  const gridStyle = getComputedStyle(grid);
  const rowHeight = parseFloat(gridStyle.gridAutoRows) || MASONRY_ROW_HEIGHT;
  const rowGap = parseFloat(gridStyle.rowGap) || 0;
  
  cards.forEach(card => {
    const cardStyle = getComputedStyle(card);
    const marginBottom = parseFloat(cardStyle.marginBottom) || 0;
    // Include the gap that will sit below the card, so columns stay even.
    const cardHeight = card.getBoundingClientRect().height + marginBottom + rowGap;
    const rowSpan = Math.max(1, Math.ceil(cardHeight / rowHeight));
    const rowEnd = `span ${rowSpan}`;
    if (card.style.gridRowEnd !== rowEnd) {
      card.style.gridRowEnd = rowEnd;
    }
  });
}

function scheduleMasonryLayout() {
  if (masonryFrame) return;
  masonryFrame = requestAnimationFrame(() => {
    masonryFrame = 0;
    layoutMasonry();
  });
}

function applyPreviewHeight(img) {
  const preview = img.parentElement;
  if (!preview) return;
  
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (width === 0 || height === 0) return;
  
  const aspectRatio = height / width;
  const containerWidth = preview.clientWidth;
  const targetHeight = Math.min(containerWidth * aspectRatio, 600); // Max 600px
  preview.style.height = `${targetHeight}px`;
}

/**
 * Adjust preview image container height based on actual image aspect ratio.
 * Called when image loads to enable masonry-style adaptive layout.
 */
window.adjustPreviewHeight = function(img) {
  applyPreviewHeight(img);
  scheduleMasonryLayout();
};

function relayoutOnResize() {
  // Card widths change with the column count, so restore the image aspect
  // ratios before packing the cards again.
  document.querySelectorAll('.preset-preview img').forEach(img => {
    if (img.naturalWidth && img.naturalHeight) {
      applyPreviewHeight(img);
    }
  });
  layoutMasonry();
}

// ═══════════════════════════════════════════════════════════════
// Event Listeners
// ═══════════════════════════════════════════════════════════════

function initEventListeners() {
  // Header actions
  document.getElementById('addPresetBtn').addEventListener('click', openCreateModal);
  document.getElementById('searchInput').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    filterPresets();
    renderPresets();
  });
  
  // Re-pack cards when the window (and therefore the column count) changes.
  window.addEventListener('resize', () => {
    clearTimeout(masonryResizeTimer);
    masonryResizeTimer = setTimeout(relayoutOnResize, 120);
  });
  
  // Modal controls
  document.getElementById('modalCloseBtn').addEventListener('click', () => hideModal('presetModal'));
  document.getElementById('modalCancelBtn').addEventListener('click', () => hideModal('presetModal'));
  document.getElementById('modalSaveBtn').addEventListener('click', handlePresetSubmit);
  
  document.getElementById('loraModalCloseBtn').addEventListener('click', () => hideModal('loraModal'));
  document.getElementById('loraModalCancelBtn').addEventListener('click', () => hideModal('loraModal'));
  
  // LoRA management
  document.getElementById('addLoraBtn').addEventListener('click', openAddLoraModal);
  
  // Click outside modal to close
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
        hideModal(modal.id);
      }
    });
  });
  
  // Preview upload
  setupPreviewUpload();
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const openModals = document.querySelectorAll('.modal[style*="display: flex"]');
      openModals.forEach(modal => hideModal(modal.id));
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════

async function init() {
  initEventListeners();
  await loadPresets();
}

// Start the app
init();
