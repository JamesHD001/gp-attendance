import { AuthService } from './auth.js';
import {
  getStudentsByClass, addStudent, deleteStudent, updateStudent,
  getSessionsByClass, createSession, deleteSession,
  getAttendanceBySession, getClassById,
  getPerformanceRatingsByClass, savePerformanceRating, getStudentMembershipType,
  updateAttendance, getNextClassDates, calculateAttendanceStats, calculateGraduationStats,
  getUserData
} from './firestore.js';
import {
  formatDate, createTable, createTableSkeleton,
  clearElement, showNotification, createModal, createButton, createInput, createSelect, createTabSkeleton
} from './ui-utils.js';
import { createStudentsSkeleton, createAttendanceSkeleton, createPerformanceSkeleton, createAnalyticsSkeleton } from './ui-utils.js';
import { Timestamp } from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js';
import { renderAnalyticsTab, createMotivationCard } from './analytics-utils.js';
import { renderGraduationTab } from './graduation-utils.js';
import {
  getInstructorAttendanceLockState,
  getMillisecondsUntilNextMinute,
  getNigeriaDateKey
} from './instructor-attendance-lock.js';
import { renderSettingsTab as renderSharedSettingsTab } from './shared-settings.js';

export class InstructorDashboard {
  constructor() {
    this.currentUser = null;
    this.userData = null;
    this.assignedClass = null;
    this.assignedClassName = '';
    this.students = [];
    this.sessions = [];
    this.performanceRatings = [];
    this.isDemoMode = false;
    this.isLoading = true;
    this.currentTab = 'overview';
    this.eventListenersInitialized = false;
    this.mobileNavInitialized = false;
    this.attendanceLockState = getInstructorAttendanceLockState();
    this.attendanceLockTickTimeout = null;
    this.attendanceLockTickInterval = null;
    this.hasShownAttendanceLockNotice = false;
  }

  async init() {
    const isLocal = typeof window !== 'undefined' &&
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

    if (isLocal) {
      this.isDemoMode = true;
      this.currentUser = AuthService.getCurrentUser();
      this.userData = {
        name: 'Local Instructor',
        email: this.currentUser?.email || 'instructor@example.test',
        role: 'instructor',
        assignedClassId: 'local-class',
        phoneNumber: '',
        address: ''
      };
      this.assignedClass = 'local-class';
      this.assignedClassName = 'Demo Class';
      this.startAttendanceLockMonitor();
      this.renderDashboard();
      this.attachFreshEventListeners();
      try {
        await this.loadStudents();
        await this.loadSessions();
        await this.loadPerformanceRatings();
      } catch (error) {
        console.warn('Instructor local-mode data load failed:', error);
      } finally {
        this.isLoading = false;
        this.renderDashboard();
        this.attachFreshEventListeners();
      }
      return;
    }

    this.startAttendanceLockMonitor();
    AuthService.onAuthStateChanged(async (user) => {
      if (!user) { window.location.href = "../index.html"; return; }
      const allowed = await AuthService.requireRole("instructor");
      if (!allowed) return;
      this.currentUser = user;
      this.isLoading = true;
      await this.loadInstructorData();
      this.renderDashboard();
      this.attachFreshEventListeners();
      try {
        await this.loadStudents();
        await this.loadSessions();
        await this.loadPerformanceRatings();
      } finally {
        this.isLoading = false;
        this.renderDashboard();
        this.attachFreshEventListeners();
      }
    });
  }

  attachFreshEventListeners() {
    this.eventListenersInitialized = false;
    this.attachEventListeners();
  }

  startAttendanceLockMonitor() {
    this.stopAttendanceLockMonitor();
    this.refreshAttendanceLockState();

    if (typeof window === 'undefined') return;

    const tick = () => {
      this.refreshAttendanceLockState({ notifyOnNewLock: true });
    };

    this.attendanceLockTickTimeout = window.setTimeout(() => {
      tick();
      this.attendanceLockTickInterval = window.setInterval(tick, 60 * 1000);
    }, getMillisecondsUntilNextMinute(new Date()) + 250);
  }

  stopAttendanceLockMonitor() {
    if (this.attendanceLockTickTimeout) {
      clearTimeout(this.attendanceLockTickTimeout);
      this.attendanceLockTickTimeout = null;
    }

    if (this.attendanceLockTickInterval) {
      clearInterval(this.attendanceLockTickInterval);
      this.attendanceLockTickInterval = null;
    }
  }

  refreshAttendanceLockState(options = {}) {
    const { notifyOnNewLock = false } = options;
    const previousState = this.attendanceLockState;
    this.attendanceLockState = getInstructorAttendanceLockState();

    const justLocked = previousState && !previousState.isLocked && this.attendanceLockState.isLocked;
    const dateChanged = previousState && previousState.currentDateKey !== this.attendanceLockState.currentDateKey;

    if (notifyOnNewLock && justLocked && !this.hasShownAttendanceLockNotice) {
      this.hasShownAttendanceLockNotice = true;
      showNotification('Attendance is now locked for today. Instructors cannot mark attendance after 4:00 PM Nigerian time.', 'warning');
    }

    if (!this.attendanceLockState.isLocked) {
      this.hasShownAttendanceLockNotice = false;
    }

    if ((justLocked || dateChanged) && this.currentTab === 'attendance' && !this.isLoading) {
      this.renderAttendanceTab();
    }

    return this.attendanceLockState;
  }

  getAttendanceLockBannerMarkup() {
    const state = this.attendanceLockState || this.refreshAttendanceLockState();
    const toneClass = state.isLocked ? 'attendance-lock-banner is-locked' : 'attendance-lock-banner is-open';
    const statusLabel = state.isLocked ? 'Locked' : 'Open';

    return `
      <div class="${toneClass}" data-attendance-lock-state="${state.isLocked ? 'locked' : 'open'}">
        <div class="attendance-lock-banner__header">
          <strong>Attendance Window: ${statusLabel}</strong>
          <span class="badge ${state.isLocked ? 'badge-danger' : 'badge-success'}">${state.currentTimeLabel} Nigeria time</span>
        </div>
        <p>${state.statusMessage}</p>
        <p class="text-muted">Cutoff time: ${state.cutoffLabel}</p>
      </div>
    `;
  }

  async loadInstructorData() {
    const profile = await getUserData(this.currentUser.uid);
    this.userData = profile || {
      name: this.currentUser?.displayName || 'Instructor',
      email: this.currentUser?.email || '',
      role: 'instructor',
      assignedClassId: null,
      phoneNumber: '',
      address: ''
    };

    this.assignedClass = this.userData.assignedClassId || this.userData.assignedClass || null;
    if (this.assignedClass) {
      const classDoc = await getClassById(this.assignedClass);
      this.assignedClassName = classDoc?.name || this.assignedClass;
    } else {
      this.assignedClassName = 'Unassigned';
    }
  }

  async loadStudents() {
    if (!this.assignedClass) {
      this.students = [];
      return;
    }
    this.students = await getStudentsByClass(this.assignedClass);
  }

  async loadSessions() {
    if (!this.assignedClass) {
      this.sessions = [];
      return;
    }
    this.sessions = await getSessionsByClass(this.assignedClass);
    for (const session of this.sessions) {
      try { session.records = await getAttendanceBySession(session.id); }
      catch { session.records = []; }
    }
  }

  async loadPerformanceRatings() {
    if (!this.assignedClass) {
      this.performanceRatings = [];
      return;
    }

    this.performanceRatings = await getPerformanceRatingsByClass(this.assignedClass);
  }

  renderDashboard() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;
    mainContent.innerHTML = `
      <div id="overviewTab" class="tab-content"></div>
      <div id="studentsTab" class="tab-content hidden"></div>
      <div id="attendanceTab" class="tab-content hidden"></div>
      <div id="performanceTab" class="tab-content hidden"></div>
      <div id="graduationTab" class="tab-content hidden"></div>
      <div id="statsTab" class="tab-content hidden"></div>
      <div id="settingsTab" class="tab-content hidden"></div>
    `;
    this.renderOverviewTab();
  }

  attachEventListeners() {
    if (this.eventListenersInitialized) return;
    this.eventListenersInitialized = true;

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await AuthService.logout();
    });

    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const tabName = link.dataset.tab;
        if (!tabName) return;
        this.switchTab(tabName);
        try { history.replaceState(null, '', link.getAttribute('href') || `#${tabName}`); } catch (_) {}
      });
    });

    window.addEventListener('hashchange', () => {
      const hash = location.hash.replace('#', '');
      const map = { overview: 'overview', students: 'students', attendance: 'attendance', performance: 'performance', graduation: 'graduation', analytics: 'stats', settings: 'settings' };
      const tabName = map[hash] || hash;
      if (tabName) this.switchTab(tabName);
    });

    const initialTab = this.getTabFromHash(location.hash);
    if (initialTab) this.switchTab(initialTab);
  }

  getTabFromHash(hashValue = '') {
    const key = (hashValue || '').replace('#', '');
    const map = {
      overview: 'overview',
      students: 'students',
      attendance: 'attendance',
      performance: 'performance',
      graduation: 'graduation',
      analytics: 'stats',
      settings: 'settings'
    };
    return map[key] || '';
  }

  switchTab(tabName) {
    if (this.currentTab === tabName) return;
    this.currentTab = tabName;

    document.querySelectorAll('.nav-link').forEach(b => {
      if (b.dataset.tab === tabName) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });

    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));

    const targetTabEl = document.getElementById(`${tabName}Tab`);
    if (targetTabEl) {
      clearElement(targetTabEl);
      let skeletonEl = createTabSkeleton();
      if (tabName === 'students') skeletonEl = createStudentsSkeleton();
      else if (tabName === 'attendance') skeletonEl = createAttendanceSkeleton();
      else if (tabName === 'performance') skeletonEl = createPerformanceSkeleton();
      else if (tabName === 'stats') skeletonEl = createAnalyticsSkeleton();
      else if (tabName === 'settings') skeletonEl = createTabSkeleton({ statsCount: 1, tableRows: 3, tableColumns: 2, showQuote: false });
      else if (tabName === 'graduation') skeletonEl = null;

      if (skeletonEl) {
        targetTabEl.appendChild(skeletonEl);
      }
      targetTabEl.classList.remove('hidden');
    }

    if (tabName === 'overview') this.renderOverviewTab();
    else if (tabName === 'students') this.renderStudentsTab();
    else if (tabName === 'attendance') this.renderAttendanceTab();
    else if (tabName === 'performance') this.renderPerformanceTab();
    else if (tabName === 'graduation') this.renderGraduationTab();
    else if (tabName === 'stats') this.renderStatsTab();
    else if (tabName === 'settings') this.renderSettingsTab();
  }

  /* ---- OVERVIEW TAB ---- */
  async renderOverviewTab() {
    const container = document.getElementById("overviewTab");
    if (!container) return;
    clearElement(container);

    const heading = document.createElement('h2');
    heading.textContent = 'Dashboard';
    container.appendChild(heading);

    if (this.isLoading) {
      container.appendChild(createTabSkeleton());
      return;
    }

    if (!this.assignedClass) {
      const empty = document.createElement('p');
      empty.className = 'text-muted';
      empty.textContent = 'No class is assigned to this instructor yet.';
      container.appendChild(empty);
      return;
    }

    try {
      // Fetch stats in parallel
      const [attendanceStats, gradStats] = await Promise.all([
        calculateAttendanceStats(this.assignedClass),
        calculateGraduationStats(this.assignedClass)
      ]);

      // Calculate attendance rate
      const studentStatsValues = Object.values(attendanceStats.studentStats || {});
      const classAttendanceRate = studentStatsValues.length === 0
        ? 0
        : Math.round(studentStatsValues.reduce((sum, s) => sum + s.attendanceRate, 0) / studentStatsValues.length);

      // Calculate graduation readiness count (threshold >= 70%)
      const graduationReadyCount = Object.values(gradStats.studentGraduationStats || {}).filter(s => s.graduationRate >= 70).length;

      // Render the metrics grid
      const grid = document.createElement('div');
      grid.className = 'stats-grid mb-xl';
      grid.innerHTML = `
        <div class="stat-card">
          <div class="stat-label">Total Students</div>
          <div class="stat-value" style="color: var(--primary-blue); font-size: 2.2rem; font-weight: 700; margin: 0.5rem 0;">${attendanceStats.totalStudents}</div>
          <div class="stat-desc text-muted">Registered in your class</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Class Attendance Rate</div>
          <div class="stat-value" style="color: var(--success-green); font-size: 2.2rem; font-weight: 700; margin: 0.5rem 0;">${classAttendanceRate}%</div>
          <div class="stat-desc text-muted">Average across all sessions</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Graduation Ready</div>
          <div class="stat-value" style="color: var(--warning-orange); font-size: 2.2rem; font-weight: 700; margin: 0.5rem 0;">${graduationReadyCount}</div>
          <div class="stat-desc text-muted">Students at or above 70% chance</div>
        </div>
      `;
      container.appendChild(grid);

      // Render Daily Inspiration Quote Card
      const quoteCard = createMotivationCard('Daily Inspiration');
      quoteCard.classList.add('mb-xl');
      container.appendChild(quoteCard);

      // Render Upcoming gathering place schedule
      const scheduleSection = document.createElement('div');
      scheduleSection.className = 'card';
      
      const scheduleHeader = document.createElement('div');
      scheduleHeader.className = 'card-header';
      scheduleHeader.textContent = 'Upcoming Gathering Place Schedule';
      scheduleSection.appendChild(scheduleHeader);

      const scheduleBody = document.createElement('div');
      scheduleBody.className = 'card-body';

      try {
        const nextDates = getNextClassDates(30);
        const scheduleList = document.createElement('div');
        scheduleList.className = 'schedule-list';

        nextDates.forEach(entry => {
          const item = document.createElement('div');
          item.className = 'schedule-item';
          item.style.padding = 'var(--spacing-md) 0';
          item.style.borderBottom = 'var(--border-width) solid var(--border-color)';
          
          const formattedDate = new Date(entry.date + 'T00:00:00').toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
          });

          // Highlight today/next class in Nigeria timezone
          const todayKey = getNigeriaDateKey(new Date());
          const isToday = entry.date === todayKey;

          item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong class="schedule-date" style="${isToday ? 'color: var(--primary-blue); font-weight: 600;' : ''}">${formattedDate} ${isToday ? '<span class="badge badge-success" style="margin-left: 6px;">Today</span>' : ''}</strong>
                <div class="schedule-classes text-muted small" style="margin-top: 4px;">${entry.classes.join(', ') || 'No classes'}</div>
              </div>
              <span class="badge ${entry.type === 'Class' ? 'badge-primary' : 'badge-secondary'}">${entry.type}</span>
            </div>
          `;
          scheduleList.appendChild(item);
        });

        if (nextDates.length === 0) {
          scheduleBody.innerHTML = '<p class="text-muted">No upcoming classes scheduled.</p>';
        } else {
          // Remove the border-bottom from the last schedule item
          if (scheduleList.lastChild) {
            scheduleList.lastChild.style.borderBottom = 'none';
          }
          scheduleBody.appendChild(scheduleList);
        }
      } catch (err) {
        console.error('Error loading overview schedule:', err);
        scheduleBody.innerHTML = '<p class="text-danger">Unable to load schedule.</p>';
      }

      scheduleSection.appendChild(scheduleBody);
      container.appendChild(scheduleSection);

    } catch (error) {
      console.error('Error loading overview data:', error);
      const errEl = document.createElement('p');
      errEl.className = 'text-danger';
      errEl.textContent = 'Error calculating overview metrics. Please ensure Firebase connection is active.';
      container.appendChild(errEl);
    }
  }

  /* ---- STUDENTS TAB ---- */
  renderStudentsTab() {
    const container = document.getElementById("studentsTab");
    clearElement(container);

    const heading = document.createElement('h2');
    heading.textContent = 'Students';
    container.appendChild(heading);

    const quoteCard = createMotivationCard();
    quoteCard.classList.add('mb-lg');
    container.appendChild(quoteCard);

    // FIX Bug 9: proper validation + notifications, no silent failures
    const formWrap = document.createElement('div');
    formWrap.className = 'flex gap-md mb-lg';
    formWrap.style.flexWrap = 'wrap';

    const nameInput = document.createElement('input');
    nameInput.type = 'text'; nameInput.placeholder = 'Student Name'; nameInput.className = 'form-input'; nameInput.style.flex = '1';

    const emailInput = document.createElement('input');
    emailInput.type = 'email'; emailInput.placeholder = 'Email (optional)'; emailInput.className = 'form-input'; emailInput.style.flex = '1';

    const phoneInput = document.createElement('input');
    phoneInput.type = 'text'; phoneInput.placeholder = 'Phone (optional)'; phoneInput.className = 'form-input'; phoneInput.style.flex = '1';

    const locationInput = document.createElement('input');
    locationInput.type = 'text'; locationInput.placeholder = 'Ward / Location (optional)'; locationInput.className = 'form-input'; locationInput.style.flex = '1';

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add Student'; addBtn.className = 'btn btn-primary';
    addBtn.addEventListener('click', async () => {
      const name = (nameInput.value || '').trim();
      if (!name) { showNotification('Student name is required', 'warning'); return; }
      addBtn.disabled = true;
      try {
        const email = (emailInput.value || '').trim() || null;
        const phone = (phoneInput.value || '').trim() || null;
        const location = (locationInput.value || '').trim() || null;
        await addStudent(name, this.assignedClass, email, phone, location);
        nameInput.value = ''; emailInput.value = ''; phoneInput.value = ''; locationInput.value = '';
        await this.loadStudents();
        this.renderStudentsTab();
        showNotification('Student added successfully', 'success');
      } catch (err) {
        console.error(err);
        showNotification('Failed to add student', 'error');
      } finally { addBtn.disabled = false; }
    });

    formWrap.append(nameInput, emailInput, phoneInput, locationInput, addBtn);
    container.appendChild(formWrap);

    if (this.isLoading) {
      container.appendChild(createTableSkeleton(6, 3));
      return;
    }

    if (this.students.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-muted';
      empty.textContent = 'No students have been added to this class yet.';
      container.appendChild(empty);
      return;
    }

    const hasSharedMembers = this.students.some(student => getStudentMembershipType(student, this.assignedClass) === 'shared');
    if (hasSharedMembers) {
      const note = document.createElement('p');
      note.className = 'text-muted';
      note.textContent = 'Shared-class members are visible here for attendance, but only students whose primary class is assigned to you can be edited or deleted from this screen.';
      container.appendChild(note);
    }

    const rows = this.students.map(s => ({
      'Name': s.name || '—',
      'Membership': getStudentMembershipType(s, this.assignedClass) === 'shared' ? 'Shared' : 'Primary',
      'Class': this.assignedClassName || '—',
      'Email': s.email || '—',
      'Phone': s.phoneNumber || '—',
      'Location': s.location || '—',
      'Actions': () => {
        const canManageRecord = s.classId === this.assignedClass;
        if (!canManageRecord) {
          const note = document.createElement('span');
          note.className = 'text-muted';
          note.textContent = 'Shared membership';
          return note;
        }

        const wrap = document.createElement('div');
        wrap.style.display = 'flex'; wrap.style.gap = '0.5rem';

        const editBtn = createButton('Edit', () => this.showEditStudentModal(s), { className: 'btn-secondary btn-small' });

        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger btn-small'; delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', () => {
          const content = document.createElement('div');
          content.innerHTML = `<p>Delete <strong>${s.name}</strong>? This will permanently remove the student record.</p>`;
          const confirmBtn = createButton('Delete', async () => {
            try { await deleteStudent(s.id); await this.loadStudents(); this.renderStudentsTab(); showNotification('Student removed', 'success'); }
            catch (err) { console.error(err); showNotification('Failed to delete student', 'error'); }
            modal.remove();
          }, { className: 'btn-danger' });
          const cancelBtn = createButton('Cancel', () => modal.remove());
          const modal = createModal('Confirm delete student', content, [confirmBtn, cancelBtn]);
          document.body.appendChild(modal);
        });

        wrap.appendChild(editBtn);
        wrap.appendChild(delBtn);
        return wrap;
      }
    }));
    container.appendChild(createTable(['Name','Membership','Class','Email','Phone','Location','Actions'], rows));
  }

  showEditStudentModal(student) {
    const nameInput = createInput('text', 'Student Name', 'instrEditName');
    nameInput.value = student.name || '';
    const emailInput = createInput('email', 'Email', 'instrEditEmail');
    emailInput.value = student.email || '';
    const phoneInput = createInput('text', 'Phone number', 'instrEditPhone');
    phoneInput.value = student.phoneNumber || '';
    const locationInput = createInput('text', 'Ward / Location', 'instrEditLocation');
    locationInput.value = student.location || '';

    const joinedInput = createInput('date', 'Joined date', 'instrEditJoined');
    try {
      if (student.createdAt && typeof student.createdAt.toDate === 'function') {
        const d = student.createdAt.toDate();
        const yyyy = d.getFullYear(); const mm = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0');
        joinedInput.value = `${yyyy}-${mm}-${dd}`;
      } else if (student.createdAt) {
        const parsed = new Date(student.createdAt);
        if (!isNaN(parsed.getTime())) {
          const yyyy = parsed.getFullYear(); const mm = String(parsed.getMonth()+1).padStart(2,'0'); const dd = String(parsed.getDate()).padStart(2,'0');
          joinedInput.value = `${yyyy}-${mm}-${dd}`;
        }
      }
    } catch (e) {}

    const form = document.createElement('div'); form.style.display='flex'; form.style.flexDirection='column'; form.style.gap='0.75rem';
    form.append(nameInput, emailInput, phoneInput, locationInput, joinedInput);

    const saveBtn = createButton('Save', async () => {
      const updates = {};
      const name = (nameInput.value||'').trim(); if (name) updates.name = name;
      const email = (emailInput.value||'').trim(); if (email) updates.email = email;
      const phone = (phoneInput.value||'').trim(); if (phone) updates.phoneNumber = phone;
      const location = (locationInput.value||'').trim(); if (location) updates.location = location;
      const joined = joinedInput.value; if (joined) updates.createdAt = Timestamp.fromDate(new Date(joined));

      try {
        await updateStudent(student.id, updates);
        showNotification('Student updated', 'success');
        await this.loadStudents();
        this.renderStudentsTab();
      } catch (err) {
        console.error('Failed to update student', err);
        showNotification('Failed to update student', 'error');
      }
      modal.remove();
    }, { className: 'btn-primary' });

    const cancelBtn = createButton('Cancel', () => modal.remove(), { className: 'btn-secondary' });
    const modal = createModal('Edit Student', form, [saveBtn, cancelBtn]);
    document.body.appendChild(modal);
  }

  /* ---- ATTENDANCE TAB ---- */
  renderAttendanceTab() {
    this.refreshAttendanceLockState();
    const container = document.getElementById("attendanceTab");
    if (!container) return;
    if (this.isLoading) {
      clearElement(container);
      container.innerHTML = '<h2>Attendance</h2>';
      container.appendChild(createTableSkeleton(5, 3));
      return;
    }
    const isLocked = this.attendanceLockState?.isLocked;
    
    const sessionsHTML = this.sessions.map(session => `
      <tr>
        <td>${formatDate(session.date)}</td>
        <td>${session.records ? session.records.filter(r => r.status === "present").length : 0} / ${session.records ? session.records.length : 0}</td>
        <td>
          <div class="flex gap-xs">
            <button class="btn btn-small btn-secondary edit-session" data-id="${session.id}" ${isLocked ? 'disabled' : ''}>Edit</button>
            <button class="btn btn-small btn-danger delete-session" data-id="${session.id}" ${isLocked ? 'disabled' : ''}>Delete</button>
          </div>
        </td>
      </tr>
    `).join("");

    container.innerHTML = `
      <h2>Attendance</h2>
      ${this.getAttendanceLockBannerMarkup()}
      <button id="newSessionBtn" class="btn ${isLocked ? 'btn-secondary' : 'btn-primary'} mb-lg" ${isLocked ? 'disabled' : ''}>${isLocked ? 'Attendance Locked' : 'New Attendance Session'}</button>
      <table class="data-table">
        <thead><tr><th>Date</th><th>Attendance</th><th>Actions</th></tr></thead>
        <tbody>${sessionsHTML || '<tr><td colspan="3" class="text-muted text-center">No attendance sessions recorded yet.</td></tr>'}</tbody>
      </table>
    `;

    const getNigeriaDateKeyForSession = (sessionDate) => {
      if (!sessionDate) return '';
      const d = sessionDate.toDate ? sessionDate.toDate() : new Date(sessionDate);
      return getNigeriaDateKey(d);
    };

    if (!isLocked) {
      document.getElementById("newSessionBtn")?.addEventListener("click", () => {
        const todayKey = getNigeriaDateKey(new Date());
        const existingSessionForToday = this.sessions.find(session => {
          const sessionKey = getNigeriaDateKeyForSession(session.date);
          return sessionKey === todayKey;
        });

        if (existingSessionForToday) {
          showNotification('An attendance session for today already exists. Redirecting to edit mode.', 'warning');
          this.renderSessionForm(existingSessionForToday);
        } else {
          this.renderSessionForm();
        }
      });
    }

    if (isLocked) return;

    // Hook up Edit buttons
    container.querySelectorAll(".edit-session").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const sessionId = e.currentTarget.dataset.id;
        const session = this.sessions.find(s => s.id === sessionId);
        if (session) {
          this.renderSessionForm(session);
        }
      });
    });

    // Hook up Delete buttons
    container.querySelectorAll(".delete-session").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const sessionId = e.currentTarget.dataset.id;
        const content = document.createElement('div');
        content.innerHTML = `<p>Delete this session? This will remove attendance records for the session.</p>`;
        const confirmBtn = createButton('Delete', async () => {
          try {
            await deleteSession(sessionId);
            await this.loadSessions();
            this.renderAttendanceTab();
            showNotification('Session deleted', 'success');
          } catch (err) { console.error(err); showNotification('Failed to delete session', 'error'); }
          modal.remove();
        }, { className: 'btn-danger' });
        const cancelBtn = createButton('Cancel', () => modal.remove());
        const modal = createModal('Confirm delete session', content, [confirmBtn, cancelBtn]);
        document.body.appendChild(modal);
      });
    });
  }

  /* ---- SESSION FORM (NEW/EDIT) ---- */
  renderSessionForm(session = null) {
    this.refreshAttendanceLockState();
    if (this.attendanceLockState?.isLocked) {
      this.renderAttendanceTab();
      showNotification('Attendance is locked for today. Instructors cannot mark attendance after 4:00 PM Nigerian time.', 'warning');
      return;
    }

    const container = document.getElementById("attendanceTab");
    if (!container) return;
    const isEditMode = !!session;
    const titleText = isEditMode ? 'Edit Attendance Session' : 'New Attendance Session';

    const statusMap = {};
    if (isEditMode && session.records) {
      session.records.forEach(r => {
        statusMap[r.studentId] = r.status;
      });
    }

    const studentsHTML = this.students.map(s => {
      const currentStatus = statusMap[s.id] || 'present';
      return `
        <tr>
          <td><strong>${s.name}</strong></td>
          <td>
            <select class="form-select" data-id="${s.id}">
              <option value="present" ${currentStatus === 'present' ? 'selected' : ''}>Present</option>
              <option value="absent" ${currentStatus === 'absent' ? 'selected' : ''}>Absent</option>
            </select>
          </td>
        </tr>
      `;
    }).join("");

    container.innerHTML = `
      <div class="flex-between mb-lg align-center">
        <h2>${titleText}</h2>
        <span class="badge ${isEditMode ? 'badge-warning' : 'badge-success'}">${isEditMode ? 'Editing Mode' : 'New Session'}</span>
      </div>
      ${this.getAttendanceLockMarkup ? this.getAttendanceLockMarkup() : this.getAttendanceLockBannerMarkup()}
      
      <div class="card mt-lg">
        <div class="card-header flex-between">
          <span>Class Attendance List</span>
          <span class="text-muted small">${isEditMode ? 'Session Date: ' + formatDate(session.date) : 'Today'}</span>
        </div>
        <div class="card-body" style="padding: 0;">
          <table class="data-table mb-0">
            <thead>
              <tr>
                <th>Student Name</th>
                <th style="width: 150px;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${studentsHTML || '<tr><td colspan="2" class="text-muted text-center">No students registered in this class yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      
      <div class="flex gap-md mt-xl">
        <button id="saveAttendance" class="btn btn-primary">${isEditMode ? 'Update Attendance' : 'Save Attendance'}</button>
        <button id="cancelSession" class="btn btn-secondary">Cancel</button>
      </div>
    `;

    document.getElementById("cancelSession")?.addEventListener("click", () => this.renderAttendanceTab());
    
    document.getElementById("saveAttendance")?.addEventListener("click", async () => {
      this.refreshAttendanceLockState();
      if (this.attendanceLockState?.isLocked) {
        this.renderAttendanceTab();
        showNotification('Attendance is locked for today. Instructors cannot mark attendance after 4:00 PM Nigerian time.', 'warning');
        return;
      }

      const btn = document.getElementById("saveAttendance");
      if (!btn) return;
      btn.disabled = true;
      btn.textContent = 'Saving...';
      
      try {
        const records = [];
        container.querySelectorAll("select[data-id]").forEach(sel => {
          const student = this.students.find(s => s.id === sel.dataset.id);
          records.push({ studentId: sel.dataset.id, name: student?.name || '', status: sel.value });
        });

        if (isEditMode) {
          // Edit mode: save using updateAttendance for each record
          for (const r of records) {
            await updateAttendance(session.id, r.studentId, r.status);
          }
          showNotification('Attendance updated', 'success');
        } else {
          // New session mode: create session
          await createSession({
            class: this.assignedClass,
            date: getNigeriaDateKey(new Date()),
            records,
            createdBy: this.currentUser?.uid || 'local-instructor'
          });
          showNotification('Attendance saved', 'success');
        }

        await this.loadSessions();
        this.renderAttendanceTab();
      } catch (err) {
        console.error(err);
        showNotification(isEditMode ? 'Failed to update attendance' : 'Failed to save attendance', 'error');
        btn.disabled = false;
        btn.textContent = isEditMode ? 'Update Attendance' : 'Save Attendance';
      }
    });
  }

  /* ---- PERFORMANCE TAB ---- */
  renderPerformanceTab() {
    const container = document.getElementById("performanceTab");
    clearElement(container);

    container.innerHTML = `
      <h2>Performance</h2>
      <p class="text-muted">Record a rating from 1 to 5 and add recommendations for each student in your class.</p>
    `;

    if (this.isLoading) {
      container.appendChild(createTableSkeleton(6, 4));
      return;
    }

    if (this.students.length === 0) {
      container.innerHTML += '<p class="text-muted">No students available for rating yet.</p>';
      return;
    }

    const ratingsByStudent = this.performanceRatings.reduce((acc, item) => {
      acc[item.studentId] = item;
      return acc;
    }, {});

    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Student</th>
          <th>Rating</th>
          <th>Recommendation</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');

    this.students.forEach(student => {
      const existing = ratingsByStudent[student.id] || {};
      const row = document.createElement('tr');

      const nameCell = document.createElement('td');
      nameCell.textContent = student.name;

      const ratingCell = document.createElement('td');
      const ratingSelect = document.createElement('select');
      ratingSelect.className = 'form-select';
      ratingSelect.innerHTML = `
        <option value="">Select rating</option>
        <option value="1">1 - Poor</option>
        <option value="2">2 - Fair</option>
        <option value="3">3 - Good</option>
        <option value="4">4 - Very Good</option>
        <option value="5">5 - Excellent</option>
      `;
      ratingSelect.value = existing.rating ? String(existing.rating) : '';
      ratingCell.appendChild(ratingSelect);

      const recommendationCell = document.createElement('td');
      const recommendationInput = document.createElement('textarea');
      recommendationInput.className = 'form-input';
      recommendationInput.rows = 2;
      recommendationInput.placeholder = 'Add instructor recommendation';
      recommendationInput.value = existing.recommendation || '';
      recommendationCell.appendChild(recommendationInput);

      const actionsCell = document.createElement('td');
      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn btn-primary btn-small';
      saveBtn.textContent = existing.rating ? 'Update' : 'Save';
      saveBtn.addEventListener('click', async () => {
        const rating = Number(ratingSelect.value);
        if (!rating) {
          showNotification('Select a rating before saving', 'warning');
          return;
        }

        saveBtn.disabled = true;
        try {
          await savePerformanceRating({
            classId: this.assignedClass,
            studentId: student.id,
            instructorId: this.currentUser?.uid || 'local-instructor',
            rating,
            recommendation: recommendationInput.value || '',
            studentName: student.name
          });
          await this.loadPerformanceRatings();
          this.renderPerformanceTab();
          showNotification(`Performance saved for ${student.name}`, 'success');
        } catch (error) {
          console.error(error);
          showNotification('Failed to save performance rating', 'error');
        } finally {
          saveBtn.disabled = false;
        }
      });
      actionsCell.appendChild(saveBtn);

      row.append(nameCell, ratingCell, recommendationCell, actionsCell);
      tbody.appendChild(row);
    });

    container.appendChild(table);
  }

  /* ---- STATISTICS TAB ---- */
  // FIX Bug 1: was missing `async` — used await without it, causing SyntaxError
  async renderStatsTab() {
    const tab = document.getElementById("statsTab");
    clearElement(tab);

    await renderAnalyticsTab(tab, [{ id: this.assignedClass, name: this.assignedClassName }], {
      assignedClassId: this.assignedClass,
      requireAuth: true,
      isDemoMode: this.isDemoMode,
      emptyStateMessage: 'Attendance analytics loads only for authenticated instructors assigned to a real class.',
      showGatheringPlaceStats: false,
      showUpcomingSchedule: false,
      classSectionTitle: 'Your Class Attendance Statistics'
    });
  }

  async renderGraduationTab() {
    const tab = document.getElementById("graduationTab");
    clearElement(tab);

    await renderGraduationTab(tab, [{ id: this.assignedClass, name: this.assignedClassName }], {
      assignedClassId: this.assignedClass,
      requireAuth: true,
      isDemoMode: this.isDemoMode,
      emptyStateMessage: 'Graduation readiness loads only for authenticated instructors assigned to a real class.',
      noClassMessage: 'No class is assigned to this instructor yet, so graduation readiness cannot be calculated.'
    });
  }

  async renderSettingsTab() {
    const tab = document.getElementById('settingsTab');
    await renderSharedSettingsTab(tab, {
      currentUser: this.currentUser,
      profile: this.userData,
      isLoading: this.isLoading,
      isDemoMode: this.isDemoMode,
      onProfileUpdated: (profile) => {
        this.userData = profile;
      }
    });
  }
}
