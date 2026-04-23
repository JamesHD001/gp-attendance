// analytics-utils.js
// Shared analytics rendering logic used by admin, instructor, and leader dashboards.

import {
  calculateAttendanceStats,
  getAttendanceByTimePeriod,
  getGatheringPlaceStats,
  getNextClassDates
} from './firestore.js';

import {
  clearElement,
  createTable,
  createSelect,
  createButton,
  triggerPrint
} from './ui-utils.js';

export const INSPIRATIONAL_QUOTES = [
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "Everything you want is on the other side of fear.", author: "George Addair" },
  { text: "Believe in yourself. You are braver than you think, more talented than you know, and capable of more than you imagine.", author: "Roy T. Bennett" },
  { text: "I learned that courage was not the absence of fear, but the triumph over it.", author: "Nelson Mandela" },
  { text: "The only impossible journey is the one you never begin.", author: "Tony Robbins" },
  { text: "Success is not about the destination, it's about the journey and the person you become.", author: "Unknown" },
  { text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese Proverb" },
  { text: "Your limitation—it's only your imagination.", author: "Unknown" },
  { text: "Push yourself, because no one else is going to do it for you.", author: "Unknown" },
  { text: "Sometimes we're tested not to show our weaknesses, but to discover our strengths.", author: "Unknown" },
  { text: "The only way out is through.", author: "Robert Frost" },
  { text: "Your potential is endless. Your growth is optional.", author: "Unknown" },
  { text: "Great things never come from comfort zones.", author: "Unknown" },
  { text: "Dream it. Believe it. Build it.", author: "Unknown" },
  { text: "Do something today that your future self will thank you for.", author: "Sean Patrick Flanery" }
];

export function displayRandomQuote(container) {
  const quote = INSPIRATIONAL_QUOTES[Math.floor(Math.random() * INSPIRATIONAL_QUOTES.length)];
  container.innerHTML = `
    <blockquote class="quote-text">"${quote.text}"</blockquote>
    <footer class="quote-author">— ${quote.author}</footer>
  `;
}

/**
 * Render the shared analytics tab content.
 *
 * @param {HTMLElement} tab         - Container element to render into.
 * @param {Array}       classes     - Full list of class objects { id, name }.
 * @param {object}      opts
 * @param {string|null} opts.assignedClassId - When set (instructor view), restrict
 *                                             the class selector to this single class.
 * @param {object}      opts.quoteIntervalRef - Object with a `current` property used
 *                                              to store/clear the quote rotation interval.
 */
export async function renderAnalyticsTab(tab, classes, opts = {}) {
  const { assignedClassId = null, quoteIntervalRef = {} } = opts;

  clearElement(tab);

  const mainContainer = document.createElement('div');
  mainContainer.className = 'analytics-container';

  // ── 1. Quote section ──────────────────────────────────────────────────────
  const quoteSection = document.createElement('div');
  quoteSection.className = 'quote-section';
  const quoteBox = document.createElement('div');
  quoteBox.className = 'quote-box';
  quoteBox.id = 'quoteBox';
  displayRandomQuote(quoteBox);
  quoteSection.appendChild(quoteBox);
  mainContainer.appendChild(quoteSection);

  if (quoteIntervalRef.current) clearInterval(quoteIntervalRef.current);
  quoteIntervalRef.current = setInterval(() => {
    const qb = document.getElementById('quoteBox');
    if (qb) displayRandomQuote(qb);
  }, 300000);

  // ── 2. GP overall statistics ──────────────────────────────────────────────
  const gpStatsSection = document.createElement('div');
  gpStatsSection.className = 'analytics-section';
  const gpStatsTitle = document.createElement('h2');
  gpStatsTitle.textContent = 'Gathering Place Overall Statistics';
  gpStatsSection.appendChild(gpStatsTitle);

  try {
    const gpStats = await getGatheringPlaceStats();
    const grid = document.createElement('div');
    grid.className = 'stats-grid';
    [
      { label: 'Total Classes',          value: gpStats.totalClasses },
      { label: 'Total Students',         value: gpStats.totalStudents },
      { label: 'Total Sessions',         value: gpStats.totalSessions },
      { label: 'Present',                value: gpStats.totalPresent },
      { label: 'Absent',                 value: gpStats.totalAbsent },
      { label: 'Overall Attendance Rate', value: gpStats.overallRate + '%' }
    ].forEach(({ label, value }) => {
      const card = document.createElement('div');
      card.className = 'stat-card';
      card.innerHTML = `<div class="stat-label">${label}</div><div class="stat-value">${value}</div>`;
      grid.appendChild(card);
    });
    gpStatsSection.appendChild(grid);
  } catch (err) {
    console.error('Error loading GP stats:', err);
    gpStatsSection.innerHTML += '<p class="text-muted">No attendance data available yet.</p>';
  }
  mainContainer.appendChild(gpStatsSection);

  // ── 3. Class-specific attendance statistics ───────────────────────────────
  const classStatsSection = document.createElement('div');
  classStatsSection.className = 'analytics-section';
  const classStatsTitle = document.createElement('h2');
  classStatsTitle.textContent = 'Attendance Statistics by Class';
  classStatsSection.appendChild(classStatsTitle);

  const filterRow = document.createElement('div');
  filterRow.className = 'filter-row';

  // Instructors only see their own class; admins/leaders see all.
  const classOptions = assignedClassId
    ? [
        { label: 'Select Class...', value: '' },
        { label: 'Your Class',      value: assignedClassId }
      ]
    : [
        { label: 'Select Class...', value: '' },
        ...classes.map(c => ({ label: c.name, value: c.id }))
      ];

  const classSelect  = createSelect(classOptions, 'analyticsClassSelect');
  const periodSelect = createSelect(
    [
      { label: 'All Time', value: 'all'      },
      { label: 'Weekly',   value: 'weekly'   },
      { label: 'Monthly',  value: 'monthly'  },
      { label: 'Annually', value: 'annually' }
    ],
    'analyticsPeriodSelect'
  );

  filterRow.appendChild(classSelect);
  filterRow.appendChild(periodSelect);
  classStatsSection.appendChild(filterRow);

  const classStatsContainer = document.createElement('div');
  classStatsContainer.id = 'classStatsContainer';
  classStatsSection.appendChild(classStatsContainer);

  const updateClassStats = async () => {
    const classId = classSelect.value;
    const period  = periodSelect.value;
    clearElement(classStatsContainer);

    if (!classId) {
      classStatsContainer.innerHTML = '<p class="text-muted">Select a class to view statistics.</p>';
      return;
    }

    try {
      const stats = period === 'all'
        ? await calculateAttendanceStats(classId)
        : await getAttendanceByTimePeriod(classId, period);

      if (stats.totalSessions === 0) {
        classStatsContainer.innerHTML = '<p class="text-muted">No attendance sessions recorded for this class.</p>';
        return;
      }

      const summaryDiv = document.createElement('div');
      summaryDiv.className = 'stats-grid';
      summaryDiv.innerHTML = `
        <div class="stat-card">
          <div class="stat-label">Total Students</div>
          <div class="stat-value">${stats.totalStudents}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Sessions Recorded</div>
          <div class="stat-value">${stats.totalSessions}</div>
        </div>
      `;
      classStatsContainer.appendChild(summaryDiv);

      if (Object.keys(stats.studentStats).length > 0) {
        const rows = Object.values(stats.studentStats).map(s => ({
          'Student': s.name,
          'Present': s.present,
          'Absent':  s.absent,
          'Total':   s.total,
          'Rate':    s.attendanceRate + '%'
        }));
        classStatsContainer.appendChild(
          createTable(['Student', 'Present', 'Absent', 'Total', 'Rate'], rows)
        );
      }
    } catch (err) {
      console.error('Error loading class stats:', err);
      classStatsContainer.innerHTML = '<p class="text-danger">Error loading statistics.</p>';
    }
  };

  classSelect.addEventListener('change',  updateClassStats);
  periodSelect.addEventListener('change', updateClassStats);
  mainContainer.appendChild(classStatsSection);

  // ── 4. Upcoming schedule ──────────────────────────────────────────────────
  const scheduleSection = document.createElement('div');
  scheduleSection.className = 'analytics-section';
  const scheduleTitle = document.createElement('h2');
  scheduleTitle.textContent = 'Upcoming Gathering Place Schedule';
  scheduleSection.appendChild(scheduleTitle);

  try {
    const nextDates = getNextClassDates(30);
    const scheduleContainer = document.createElement('div');
    scheduleContainer.className = 'schedule-list';

    nextDates.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'schedule-item';
      const formattedDate = new Date(entry.date + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
      item.innerHTML = `
        <div class="schedule-date">${formattedDate}</div>
        <div class="schedule-info">
          <div class="schedule-type">${entry.type}</div>
          ${entry.classes.length
            ? `<div class="schedule-classes">${entry.classes.join(', ')}</div>`
            : ''}
        </div>
      `;
      scheduleContainer.appendChild(item);
    });
    scheduleSection.appendChild(scheduleContainer);
  } catch (err) {
    console.error('Error loading schedule:', err);
    scheduleSection.innerHTML += '<p class="text-danger">Error loading schedule.</p>';
  }
  mainContainer.appendChild(scheduleSection);

  // ── Print button (prepended so it sits above all sections) ────────────────
  const printBtn = createButton('Print Report', () => triggerPrint());
  printBtn.className = 'btn btn-secondary mt-lg mb-lg';
  mainContainer.insertBefore(printBtn, mainContainer.firstChild);

  tab.appendChild(mainContainer);
}