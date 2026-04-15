// UI Utilities Module
// Helper functions for DOM manipulation and UI operations

export function showElement(element) {
  if (element) {
    element.classList.remove('hidden');
  }
}

export function hideElement(element) {
  if (element) {
    element.classList.add('hidden');
  }
}

export function toggleElement(element) {
  if (element) {
    element.classList.toggle('hidden');
  }
}

export function clearElement(element) {
  if (element) {
    element.innerHTML = '';
  }
}

export function showNotification(message, type = 'success') {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  notification.setAttribute('role', 'alert');

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('show');
  }, 10);

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

export function formatDate(date) {
  if (!date) return '';
  if (date.toDate) {
    date = date.toDate();
  }
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function formatDateTime(date) {
  if (!date) return '';
  if (date.toDate) {
    date = date.toDate();
  }
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function convertToLocalDateInput(date) {
  if (!date) return '';
  if (date.toDate) {
    date = date.toDate();
  }
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  return `${year}-${month}-${day}`;
}

export function createTable(headers, rows, options = {}) {
  const table = document.createElement('table');
  table.className = 'data-table';

  // Create header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headers.forEach(header => {
    const th = document.createElement('th');
    th.textContent = header;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Create body
  const tbody = document.createElement('tbody');
  rows.forEach(row => {
    const tr = document.createElement('tr');
    if (typeof row === 'object' && !Array.isArray(row)) {
      headers.forEach(header => {
        const td = document.createElement('td');
        const value = row[header];
        if (typeof value === 'function') {
          td.appendChild(value());
        } else {
          td.textContent = value || '';
        }
        tr.appendChild(td);
      });
    } else {
      row.forEach(cell => {
        const td = document.createElement('td');
        if (typeof cell === 'function') {
          td.appendChild(cell());
        } else if (cell instanceof Element) {
          td.appendChild(cell);
        } else {
          td.textContent = cell || '';
        }
        tr.appendChild(td);
      });
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
}

export function createCard(title, content) {
  const card = document.createElement('div');
  card.className = 'card';

  const cardHeader = document.createElement('div');
  cardHeader.className = 'card-header';
  cardHeader.textContent = title;

  const cardBody = document.createElement('div');
  cardBody.className = 'card-body';
  if (typeof content === 'string') {
    cardBody.textContent = content;
  } else {
    cardBody.appendChild(content);
  }

  card.appendChild(cardHeader);
  card.appendChild(cardBody);

  return card;
}

export function createStatCard(label, value) {
  const card = document.createElement('div');
  card.className = 'stat-card';

  const statLabel = document.createElement('div');
  statLabel.className = 'stat-label';
  statLabel.textContent = label;

  const statValue = document.createElement('div');
  statValue.className = 'stat-value';
  statValue.textContent = value;

  card.appendChild(statLabel);
  card.appendChild(statValue);

  return card;
}

export function createButton(text, onClick, options = {}) {
  const button = document.createElement('button');
  button.textContent = text;
  button.className = `btn ${options.className || 'btn-primary'}`;
  button.disabled = options.disabled || false;

  if (onClick) {
    button.addEventListener('click', onClick);
  }

  if (options.title) {
    button.setAttribute('title', options.title);
  }

  return button;
}

export function createInput(type, placeholder, id, options = {}) {
  const input = document.createElement('input');
  input.type = type;
  input.placeholder = placeholder;
  if (id) input.id = id;
  input.className = options.className || 'form-input';

  if (options.value) input.value = options.value;
  if (options.required) input.required = true;
  if (options.disabled) input.disabled = true;

  return input;
}

export function createSelect(options, id, defaultValue = '') {
  const select = document.createElement('select');
  if (id) select.id = id;
  select.className = 'form-select';

  options.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt.value || opt;
    option.textContent = opt.label || opt;
    if (opt.value === defaultValue) option.selected = true;
    select.appendChild(option);
  });

  return select;
}

export function createModal(title, content, buttons = []) {
  const modal = document.createElement('div');
  modal.className = 'modal';

  const modalContent = document.createElement('div');
  modalContent.className = 'modal-content';

  const modalHeader = document.createElement('div');
  modalHeader.className = 'modal-header';

  const modalTitle = document.createElement('h2');
  modalTitle.textContent = title;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', () => modal.remove());

  modalHeader.appendChild(modalTitle);
  modalHeader.appendChild(closeBtn);

  const modalBody = document.createElement('div');
  modalBody.className = 'modal-body';
  if (typeof content === 'string') {
    modalBody.textContent = content;
  } else {
    modalBody.appendChild(content);
  }

  const modalFooter = document.createElement('div');
  modalFooter.className = 'modal-footer';
  buttons.forEach(btn => {
    modalFooter.appendChild(btn);
  });

  modalContent.appendChild(modalHeader);
  modalContent.appendChild(modalBody);
  if (buttons.length > 0) {
    modalContent.appendChild(modalFooter);
  }

  modal.appendChild(modalContent);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  // Make modal visible for animations
  // Use requestAnimationFrame to ensure styles apply after insertion
  requestAnimationFrame(() => modal.classList.add('show'));

  return modal;
}

export function triggerPrint() {
  window.print();
}

export function showLoading(element) {
  if (element) {
    const loader = document.createElement('div');
    loader.className = 'loader';
    element.appendChild(loader);
    element.style.pointerEvents = 'none';
    element.style.opacity = '0.6';
  }
}

export function hideLoading(element) {
  if (element) {
    const loader = element.querySelector('.loader');
    if (loader) loader.remove();
    element.style.pointerEvents = 'auto';
    element.style.opacity = '1';
  }
}
