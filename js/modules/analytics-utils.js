// analytics-utils.js
// Shared analytics rendering logic used by admin, instructor, and leader dashboards.

import {
  calculateAttendanceStats,
  getAttendanceByTimePeriod,
  getGatheringPlaceStats,
  getNextClassDates
} from './firestore.js';
import { auth } from '../firebase-config.js';

import {
  clearElement,
  createTable,
  createSelect,
  createButton,
  triggerPrint
} from './ui-utils.js';

export const INSPIRATIONAL_QUOTES = [
  { text: "Trust in the Lord with all thine heart.", author: "Proverbs 3:5" },
  { text: "With God nothing shall be impossible.", author: "Luke 1:37" },
  { text: "Charity never faileth.", author: "Moroni 7:46" },
  { text: "If ye are prepared ye shall not fear.", author: "Doctrine and Covenants 38:30" },
  { text: "Men are, that they might have joy.", author: "2 Nephi 2:25" },
  { text: "By small and simple things are great things brought to pass.", author: "Alma 37:6" },
  { text: "Look unto me in every thought; doubt not, fear not.", author: "Doctrine and Covenants 6:36" },
  { text: "When ye are in the service of your fellow beings ye are only in the service of your God.", author: "Mosiah 2:17" },
  { text: "Perfect love casteth out all fear.", author: "Moroni 8:16" },
  { text: "Ye receive no witness until after the trial of your faith.", author: "Ether 12:6" },
  { text: "Faith is things which are hoped for and not seen.", author: "Ether 12:6" },
  { text: "Pray always, that you may come off conqueror.", author: "Doctrine and Covenants 10:5" },
  { text: "Be ye doers of the word, and not hearers only.", author: "James 1:22" },
  { text: "A willing mind is accepted of God.", author: "Doctrine and Covenants 64:34" },
  { text: "Ye are the light of the world.", author: "Matthew 5:14" },
  { text: "Let your light so shine before men.", author: "Matthew 5:16" },
  { text: "Ask, and it shall be given you; seek, and ye shall find.", author: "Matthew 7:7" },
  { text: "To learn is to choose growth every day.", author: "Gospel Principle" },
  { text: "Discipline today builds confidence tomorrow.", author: "Inspiration" },
  { text: "He who serves most, leads best.", author: "Leadership Saying" },
  { text: "Progress is often quiet, but it is never wasted.", author: "Inspiration" },
  { text: "Consistency is a spiritual and practical superpower.", author: "Inspiration" },
  { text: "Your effort matters, even before results appear.", author: "Inspiration" },
  { text: "Small daily obedience creates big lifelong strength.", author: "Gospel Inspiration" },
  { text: "Excellence grows where humility is welcome.", author: "Inspiration" },
  { text: "You can begin again today with faith.", author: "Inspiration" },
  { text: "A teachable heart is a powerful gift.", author: "Inspiration" },
  { text: "Prayer opens doors that pressure cannot.", author: "Gospel Inspiration" },
  { text: "Show up. Serve well. Keep learning.", author: "Inspiration" },
  { text: "You do not have to be perfect to be useful.", author: "Inspiration" },
  { text: "God can do much with a willing soul.", author: "Gospel Inspiration" },
  { text: "Gratitude turns ordinary days into holy opportunities.", author: "Gospel Inspiration" },
  { text: "Courage often looks like your next right step.", author: "Inspiration" },
  { text: "Choose kindness quickly and often.", author: "Inspiration" },
  { text: "Strong communities are built by dependable people.", author: "Inspiration" },
  { text: "Let purpose, not pressure, set your pace.", author: "Inspiration" },
  { text: "Learning by doing turns hope into skill.", author: "Inspiration" },
  { text: "Hard work and prayer are good partners.", author: "Gospel Inspiration" },
  { text: "Peace grows where forgiveness is practiced.", author: "Gospel Inspiration" },
  { text: "Integrity is what you do when no one is checking.", author: "Inspiration" },
  { text: "The Lord strengthens those who keep trying.", author: "Gospel Inspiration" },
  { text: "Your future is shaped by faithful habits.", author: "Inspiration" },
  { text: "Patience is not passive; it is steady trust.", author: "Inspiration" },
  { text: "Make room for both ambition and compassion.", author: "Inspiration" },
  { text: "Preparation invites confidence and calm.", author: "Inspiration" },
  { text: "Work with your hands; grow with your heart.", author: "Inspiration" },
  { text: "Where unity lives, miracles multiply.", author: "Gospel Inspiration" },
  { text: "A class becomes great when everyone belongs.", author: "Inspiration" },
  { text: "Be honest, be reliable, be kind.", author: "Inspiration" },
  { text: "Faithful effort is never lost.", author: "Gospel Inspiration" },
  { text: "Serve one person today with full attention.", author: "Inspiration" },
  { text: "Your gifts grow as you use them.", author: "Inspiration" },
  { text: "Choose progress over comparison.", author: "Inspiration" },
  { text: "Let truth guide your decisions.", author: "Gospel Inspiration" },
  { text: "Hope is stronger when shared.", author: "Inspiration" },
  { text: "Do simple things with great love.", author: "Inspiration" },
  { text: "The right time to improve is now.", author: "Inspiration" },
  { text: "Lift others, and you rise too.", author: "Inspiration" },
  { text: "Be faithful in little things.", author: "Luke 16:10" },
  { text: "Press forward with a steadfastness in Christ.", author: "2 Nephi 31:20" }
];

function createAnalyticsSkeleton() {
  const skeleton = document.createElement('div');
  skeleton.className = 'analytics-skeleton';
  skeleton.innerHTML = `
    <div class="skeleton-block skeleton-quote"></div>
    <div class="skeleton-block skeleton-section"></div>
    <div class="skeleton-block skeleton-section"></div>
    <div class="skeleton-block skeleton-section"></div>
  `;
  return skeleton;
}

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
  const {
    assignedClassId = null,
    quoteIntervalRef = {},
    requireAuth = false,
    isDemoMode = false,
    emptyStateMessage = 'Sign in to view analytics.'
  } = opts;

  clearElement(tab);
  const skeleton = createAnalyticsSkeleton();
  tab.appendChild(skeleton);

  const isAuthenticated = Boolean(auth?.currentUser);

  if ((requireAuth && !isAuthenticated) || isDemoMode) {
    clearElement(tab);
    tab.innerHTML = `
      <div class="card">
        <div class="card-header">Attendance Analytics</div>
        <div class="card-body">${emptyStateMessage}</div>
      </div>
    `;
    return;
  }

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

  const classSelect  = createSelect(classOptions, 'analyticsClassSelect', assignedClassId || '');
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
  if (assignedClassId) {
    await updateClassStats();
  }
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

  clearElement(tab);
  tab.appendChild(mainContainer);
}
