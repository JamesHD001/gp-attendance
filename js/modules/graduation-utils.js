import {
  calculateGraduationStats,
  getGraduationOverview
} from './firestore.js';
import { auth } from '../firebase-config.js';

import {
  clearElement,
  createButton,
  createSelect,
  createTable,
  createStatsSkeleton,
  createTableSkeleton,
  triggerPrint
} from './ui-utils.js';

function createSummaryGrid(items) {
  const grid = document.createElement('div');
  grid.className = 'stats-grid';

  items.forEach(({ label, value }) => {
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `<div class="stat-label">${label}</div><div class="stat-value">${value}</div>`;
    grid.appendChild(card);
  });

  return grid;
}

export async function renderGraduationTab(tab, classes, opts = {}) {
  const {
    assignedClassId = null,
    requireAuth = false,
    isDemoMode = false,
    emptyStateMessage = 'Sign in to view graduation readiness.',
    noClassMessage = 'No class is available for graduation readiness yet.'
  } = opts;
  clearElement(tab);

  const container = document.createElement('div');
  container.className = 'analytics-container';
  const validClasses = (classes || []).filter(item => item && item.id);

  const isAuthenticated = Boolean(auth?.currentUser);

  if ((requireAuth && !isAuthenticated) || isDemoMode) {
    container.innerHTML = `
      <div class="card">
        <div class="card-header">Graduation Readiness</div>
        <div class="card-body">${emptyStateMessage}</div>
      </div>
    `;
    tab.appendChild(container);
    return;
  }

  if (assignedClassId == null && validClasses.length === 0) {
    container.innerHTML = `
      <div class="card">
        <div class="card-header">Graduation Readiness</div>
        <div class="card-body">${noClassMessage}</div>
      </div>
    `;
    tab.appendChild(container);
    return;
  }

  const heading = document.createElement('div');
  heading.className = 'flex-between mb-lg';
  heading.innerHTML = `
    <div>
      <h2>Graduation Readiness</h2>
      <p class="text-muted">Attendance contributes 70% and instructor performance contributes 30%.</p>
    </div>
  `;
  container.appendChild(heading);

  const controls = document.createElement('div');
  controls.className = 'flex gap-md mb-lg flex-wrap';

  const classOptions = assignedClassId
    ? [{ label: 'Your Class', value: assignedClassId }]
    : [
        { label: 'Select Class...', value: '' },
        ...validClasses.map(item => ({ label: item.name, value: item.id }))
      ];

  const classSelect = createSelect(classOptions, 'graduationClassSelect', assignedClassId || '');
  const printBtn = createButton('Print Graduation Report', () => triggerPrint(), {
    className: 'btn-secondary'
  });

  controls.append(classSelect, printBtn);
  container.appendChild(controls);

  const summaryContainer = document.createElement('div');
  const detailsContainer = document.createElement('div');
  container.append(summaryContainer, detailsContainer);
  summaryContainer.appendChild(createStatsSkeleton(4));
  detailsContainer.appendChild(createTableSkeleton(5, 5));

  const renderOverview = async () => {
    clearElement(summaryContainer);

    if (assignedClassId) {
      return;
    }

    const overview = await getGraduationOverview(validClasses.map(item => item.id));
    summaryContainer.appendChild(createSummaryGrid([
      { label: 'Tracked Classes', value: overview.totalClasses },
      { label: 'Students', value: overview.totalStudents },
      { label: 'Rated Students', value: overview.ratedStudents },
      { label: 'Average Graduation Rate', value: `${overview.overallAverage}%` }
    ]));
  };

  const renderClassDetails = async () => {
    clearElement(detailsContainer);
    detailsContainer.appendChild(createTableSkeleton(5, 5));

    const classId = classSelect.value;
    if (!classId) {
      detailsContainer.innerHTML = `<p class="text-muted">${assignedClassId ? noClassMessage : 'Select a class to view graduation readiness.'}</p>`;
      return;
    }

    let stats;
    try {
      stats = await calculateGraduationStats(classId);
    } catch (error) {
      console.error('Error loading graduation stats:', error);
      detailsContainer.innerHTML = '<p class="text-danger">Unable to load graduation readiness for this user right now.</p>';
      return;
    }

    detailsContainer.appendChild(createSummaryGrid([
      { label: 'Class', value: stats.className },
      { label: 'Sessions Recorded', value: stats.totalSessions },
      { label: 'Students', value: stats.totalStudents },
      { label: 'Average Graduation Rate', value: `${stats.averageGraduationRate}%` }
    ]));

    if (stats.totalStudents === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-muted';
      empty.textContent = 'No students are assigned to this class yet.';
      detailsContainer.appendChild(empty);
      return;
    }

    const ratedNotice = document.createElement('p');
    ratedNotice.className = 'text-muted';
    ratedNotice.textContent = `${stats.ratedStudents} of ${stats.totalStudents} students have instructor performance ratings recorded.`;
    detailsContainer.appendChild(ratedNotice);

    const rows = Object.values(stats.studentGraduationStats).map(student => ({
      'Student': student.name,
      'Attendance': `${student.attendanceRate}%`,
      'Performance': student.performanceRating ? `${student.performanceRating}/5` : 'Not rated',
      'Graduation Chance': `${student.graduationRate}%`,
      'Recommendation': student.recommendation || '—'
    }));

    detailsContainer.appendChild(
      createTable(['Student', 'Attendance', 'Performance', 'Graduation Chance', 'Recommendation'], rows)
    );
  };

  classSelect.addEventListener('change', renderClassDetails);

  try {
    await renderOverview();
    await renderClassDetails();
  } catch (error) {
    console.error('Error initializing graduation tab:', error);
    clearElement(tab);
    tab.innerHTML = '<p class="text-danger">Unable to load graduation readiness for the available class data right now.</p>';
    return;
  }

  tab.appendChild(container);
}
