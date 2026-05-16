import { createButton, createModal, createTable, formatDate } from './ui-utils.js';

function sortStudentsByName(students = []) {
  return [...students].sort((left, right) => {
    const leftName = (left?.name || '').trim().toLowerCase();
    const rightName = (right?.name || '').trim().toLowerCase();
    return leftName.localeCompare(rightName);
  });
}

function buildParticipantRows(students = []) {
  return sortStudentsByName(students).map(student => ({
    'Name': student.name || '—',
    'Email': student.email || '—',
    'Phone': student.phoneNumber || '—',
    'Location': student.location || '—',
    'Joined': student.createdAt ? formatDate(student.createdAt) : '—'
  }));
}

export function showClassParticipantsModal(classRecord, students = [], options = {}) {
  const className = classRecord?.name || 'Selected Class';
  const participantCount = students.length;

  const content = document.createElement('div');

  const summary = document.createElement('p');
  summary.className = 'text-muted';
  summary.textContent = `${participantCount} participant${participantCount === 1 ? '' : 's'} in ${className}.`;
  content.appendChild(summary);

  if (options.note) {
    const note = document.createElement('p');
    note.className = 'text-muted';
    note.textContent = options.note;
    content.appendChild(note);
  }

  if (participantCount === 0) {
    const emptyState = document.createElement('p');
    emptyState.className = 'text-muted';
    emptyState.textContent = 'No students are currently assigned to this class.';
    content.appendChild(emptyState);
  } else {
    content.appendChild(createTable(
      ['Name', 'Email', 'Phone', 'Location', 'Joined'],
      buildParticipantRows(students)
    ));
  }

  let modal;
  const closeBtn = createButton('Close', () => modal.remove(), { className: 'btn-secondary' });
  modal = createModal(`Participants — ${className}`, content, [closeBtn]);
  modal.classList.add('participants-modal');
  modal.querySelector('.modal-content')?.classList.add('modal-content-wide');
  document.body.appendChild(modal);
  return modal;
}
