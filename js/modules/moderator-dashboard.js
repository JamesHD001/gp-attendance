import { auth, db } from '../firebase-config.js';
import { AuthService } from './auth.js';
import { getClasses, getAllUsers, getStudentsByClass, getStudents, createSession, getUserData } from './firestore.js';
import { doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js';
import { clearElement, showNotification, createButton, createInput, createSelect, createTable, createStatCard } from './ui-utils.js';

class ModeratorDashboard {
  constructor() {
    this.user = null;
    this.role = null;
    this.classes = [];
    this.users = [];
    this.students = [];
    this.tab = 'overview';
  }

  async init() {
    if (!await AuthService.requireRole('moderator')) return;
    this.user = auth.currentUser;
    const profile = await getUserData(this.user.uid);
    this.role = profile?.role;
    if (this.role !== 'moderator') {
      await AuthService.redirectBasedOnRole(this.user);
      return;
    }

    await Promise.all([this.loadClasses(), this.loadUsers(), this.loadStudents()]);
    this.bindNavigation();
    this.tab = window.location.hash.replace('#', '') || 'overview';
    this.render();
  }

  async loadClasses() { this.classes = await getClasses(); }
  async loadUsers() { this.users = await getAllUsers(); }
  async loadStudents() { this.students = await getStudents(); }

  bindNavigation() {
    document.querySelectorAll('[data-tab]').forEach(link => link.addEventListener('click', event => {
      event.preventDefault();
      this.tab = link.dataset.tab;
      history.replaceState(null, '', `#${this.tab}`);
      this.render();
    }));
    document.getElementById('logoutBtn')?.addEventListener('click', () => AuthService.logout({ reason: 'manual' }));
  }

  render() {
    const main = document.getElementById('moderatorContent');
    clearElement(main);

    const header = document.createElement('div');
    header.className = 'dashboard-content-header mb-xl';
    header.innerHTML = '<div><div class="section-eyebrow">Moderator Dashboard</div><h1>GP Attendance Moderator</h1><p class="text-muted">Attendance operations and read-only access to classes, students, and instructors.</p></div>';
    main.appendChild(header);

    if (this.tab === 'overview') this.renderOverview(main);
    else if (this.tab === 'class-attendance') this.renderClassAttendance(main);
    else if (this.tab === 'general-attendance') this.renderGeneralAttendance(main);
    else if (this.tab === 'instructor-attendance') this.renderInstructorAttendance(main);
    else if (this.tab === 'classes') this.renderReadOnlyTable(main, 'Classes', ['Name', 'Type', 'Instructor'], this.classes.map(c => ({
      Name: c.name || '—',
      Type: c.isGeneralClass ? 'General / Shared' : 'Primary',
      Instructor: this.instructorsFor(c).join(', ') || 'Unassigned'
    })));
    else if (this.tab === 'students') this.renderReadOnlyTable(main, 'Students', ['Name', 'Class', 'Email', 'Phone'], this.students.map(s => ({
      Name: s.name || '—',
      Class: this.classes.find(c => c.id === s.classId)?.name || 'Unassigned',
      Email: s.email || '—',
      Phone: s.phoneNumber || '—'
    })));
    else if (this.tab === 'users') this.renderReadOnlyTable(main, 'Instructors', ['Name', 'Email', 'Class'], this.users.filter(u => u.role === 'instructor').map(u => ({
      Name: u.name || '—',
      Email: u.email || '—',
      Class: this.classes.find(c => c.id === u.assignedClassId)?.name || 'Unassigned'
    })));

    document.querySelectorAll('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.tab === this.tab));
    if (window.lucide) window.lucide.createIcons();
  }

  instructorsFor(classRecord) {
    return this.users
      .filter(user => user.role === 'instructor' && (user.id === classRecord.instructorId || user.assignedClassId === classRecord.id))
      .map(user => user.name || user.email || user.id);
  }

  renderOverview(main) {
    const stats = document.createElement('div');
    stats.className = 'flex gap-lg flex-wrap mb-lg';
    stats.append(
      createStatCard('Classes', this.classes.length),
      createStatCard('Students', this.students.length),
      createStatCard('Instructors', this.users.filter(user => user.role === 'instructor').length)
    );
    main.appendChild(stats);

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<div class="card-header">Attendance Operations</div><div class="card-body"><p class="text-muted">Use these tools when an instructor forgets to mark a class, when general attendance needs to be recorded, or when instructor attendance needs correction.</p></div>';
    const actions = document.createElement('div');
    actions.className = 'flex gap-md flex-wrap';
    actions.append(
      createButton('Mark Class Attendance', () => { this.tab = 'class-attendance'; this.render(); }, { className: 'btn-primary' }),
      createButton('Mark General Attendance', () => { this.tab = 'general-attendance'; this.render(); }, { className: 'btn-outline' }),
      createButton('Mark Instructor Attendance', () => { this.tab = 'instructor-attendance'; this.render(); }, { className: 'btn-outline' })
    );
    card.querySelector('.card-body').appendChild(actions);
    main.appendChild(card);
  }

  renderClassAttendance(main) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<div class="card-header">Mark Individual Class Attendance</div>';
    const body = document.createElement('div');
    body.className = 'card-body';

    const dateInput = createInput('date', 'Attendance date', 'moderatorAttendanceDate', { value: new Date().toISOString().slice(0, 10) });
    const classSelect = createSelect([{ label: 'Select class...', value: '' }, ...this.classes.map(c => ({ label: c.name, value: c.id }))], 'moderatorClass');
    body.append(dateInput, classSelect);

    const list = document.createElement('div');
    list.className = 'attendance-list mt-md';
    body.appendChild(list);

    let loadedStudents = [];
    const load = async () => {
      clearElement(list);
      if (!classSelect.value) {
        list.innerHTML = '<p class="text-muted">Select a class to load its roster.</p>';
        loadedStudents = [];
        return;
      }
      loadedStudents = await getStudentsByClass(classSelect.value);
      if (!loadedStudents.length) {
        list.innerHTML = '<p class="text-muted">No students are assigned to this class.</p>';
        return;
      }
      loadedStudents.forEach(student => {
        const row = document.createElement('label');
        row.className = 'flex gap-md align-center mb-sm';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.dataset.studentId = student.id;
        row.append(checkbox, document.createTextNode(student.name || student.id));
        list.appendChild(row);
      });
    };
    classSelect.addEventListener('change', () => void load());

    body.appendChild(createButton('Save Attendance', async () => {
      if (!classSelect.value) { showNotification('Select a class first.', 'warning'); return; }
      try {
        const records = loadedStudents.map(student => ({
          studentId: student.id,
          status: list.querySelector(`[data-student-id="${student.id}"]`)?.checked ? 'present' : 'absent'
        }));
        await createSession({ classId: classSelect.value, date: dateInput.value, records, createdBy: this.user.uid });
        showNotification('Class attendance saved.', 'success');
      } catch (error) {
        console.error(error);
        showNotification(error?.message || 'Failed to save class attendance.', 'error');
      }
    }, { className: 'btn-primary' }));

    card.appendChild(body);
    main.appendChild(card);
  }

  renderGeneralAttendance(main) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<div class="card-header">Mark General Gathering Place Attendance</div>';
    const body = document.createElement('div');
    body.className = 'card-body';
    const dateInput = createInput('date', 'Attendance date', 'generalAttendanceDate', { value: new Date().toISOString().slice(0, 10) });
    const present = createInput('number', 'Present', 'generalPresent');
    const absent = createInput('number', 'Absent', 'generalAbsent');
    present.min = absent.min = '0';
    body.append(dateInput, present, absent);
    body.appendChild(createButton('Save General Attendance', async () => {
      const p = Number(present.value || 0), a = Number(absent.value || 0);
      if (p < 0 || a < 0) { showNotification('Attendance values cannot be negative.', 'warning'); return; }
      try {
        await createSession({ classId: 'GENERAL', date: dateInput.value, generalSummary: { present: p, absent: a, total: p + a }, createdBy: this.user.uid });
        showNotification('General attendance saved.', 'success');
      } catch (error) {
        console.error(error);
        showNotification(error?.message || 'Failed to save general attendance.', 'error');
      }
    }, { className: 'btn-primary' }));
    card.appendChild(body);
    main.appendChild(card);
  }

  renderInstructorAttendance(main) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<div class="card-header">Mark / Correct Instructor Attendance</div>';
    const body = document.createElement('div');
    body.className = 'card-body';
    const dateInput = createInput('date', 'Attendance date', 'instructorAttendanceDate', { value: new Date().toISOString().slice(0, 10) });
    const list = document.createElement('div');
    list.className = 'attendance-list mt-md';
    const instructors = this.users.filter(user => user.role === 'instructor');
    instructors.forEach(instructor => {
      const row = document.createElement('label');
      row.className = 'flex gap-md align-center mb-sm';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.dataset.instructorId = instructor.id;
      row.append(checkbox, document.createTextNode(instructor.name || instructor.email || instructor.id));
      list.appendChild(row);
    });
    body.append(dateInput, list);
    body.appendChild(createButton('Save Instructor Attendance', async () => {
      try {
        const date = dateInput.value;
        for (const instructor of instructors) {
          const recordId = `${date}__${instructor.id}`;
          await setDoc(doc(db, 'instructorAttendance', recordId), {
            instructorId: instructor.id,
            date,
            status: list.querySelector(`[data-instructor-id="${instructor.id}"]`)?.checked ? 'present' : 'absent',
            markedBy: this.user.uid,
            updatedAt: serverTimestamp()
          }, { merge: true });
        }
        showNotification('Instructor attendance saved.', 'success');
      } catch (error) {
        console.error(error);
        showNotification(error?.message || 'Failed to save instructor attendance.', 'error');
      }
    }, { className: 'btn-primary' }));
    card.appendChild(body);
    main.appendChild(card);
  }

  renderReadOnlyTable(main, title, columns, rows) {
    const heading = document.createElement('h2');
    heading.textContent = title;
    main.appendChild(heading);
    if (rows.length) {
      main.appendChild(createTable(columns, rows));
    } else {
      const empty = document.createElement('p');
      empty.className = 'text-muted';
      empty.textContent = 'No records available.';
      main.appendChild(empty);
    }
  }
}

new ModeratorDashboard().init();
