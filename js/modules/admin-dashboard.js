// Admin Dashboard Module
// Handles all admin-specific functionality

import {
  initializeClasses,
  getClasses,
  getAllUsers,
  createClass,
  updateClassLockStatus,
  deleteUser,
  calculateAttendanceStats,
  createAttendanceSession,
  addStudent,
  getStudents,
  deleteStudent
} from './firestore.js';

import { AuthService } from './auth.js';

// Firebase imports for creating leaders/instructors
import { auth, db, firebaseConfig } from '../firebase-config.js';
import { initializeApp, getApps, deleteApp } from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signOut as signOutSecondaryAuth } from 'https://www.gstatic.com/firebasejs/10.7.2/firebase-auth.js';
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.2/firebase-firestore.js";

import {
  clearElement,
  showNotification,
  createTable,
  createCard,
  createStatCard,
  createButton,
  createInput,
  createSelect,
  createModal,
  triggerPrint
} from './ui-utils.js';

export class AdminDashboard {
  constructor() {
    this.currentUser = null;
    this.classes = [];
    this.users = [];
    this.students = [];
  }

  async init() {

    AuthService.onAuthStateChanged(async (user) => {

      if (!user) {
        window.location.href = '../index.html';
        return;
      }

      const allowed = await AuthService.requireRole('admin');
      if (!allowed) return;

      this.currentUser = user;

      try {

        await initializeClasses();

        await this.loadClasses();
        await this.loadUsers();
        await this.loadStudents();

        this.renderDashboard();

        this.setupEventListeners();

      } catch (error) {

        console.error('Admin initialization failed:', error);

        showNotification('Failed to initialize admin dashboard', 'error');

      }

    });

  }

  async loadClasses() {

    try {

      this.classes = await getClasses();

    } catch (error) {

      console.error('Error loading classes:', error);

      showNotification('Failed to load classes', 'error');

    }

  }

  async loadUsers() {

    try {

      this.users = await getAllUsers();

    } catch (error) {

      console.error('Error loading users:', error);

    }

  }

  async loadStudents(){

    try{

      this.students = await getStudents();

    }catch(err){

      console.error('Error loading students',err);

    }

  }

  setupEventListeners() {

    const logoutBtn = document.getElementById('logoutBtn');

    if (logoutBtn) {

      logoutBtn.addEventListener('click', async () => {

        await AuthService.logout();

        window.location.href = '../index.html';

      });

    }

    const tabButtons = document.querySelectorAll('.tab-btn');

    tabButtons.forEach(btn => {

      btn.addEventListener('click', (e) => {

        const tabName = e.target.dataset.tab;

        this.switchTab(tabName, e);

      });

    });

    // Sidebar nav links -> map hash to internal tabs
    const navLinks = document.querySelectorAll('.nav-link');
    const mapHashToTab = (hash) => {
      if (!hash) return '';
      const key = hash.replace('#','');
      const map = {
        overview: 'overview',
        classes: 'classes',
        users: 'users',
        attendance: 'students',
        analytics: 'analytics'
      };
      return map[key] || key;
    };

    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const tabName = mapHashToTab(link.getAttribute('href') || '');
        if (!tabName) return;
        // Update active nav link
        navLinks.forEach(n => n.classList.remove('active'));
        link.classList.add('active');
        // Trigger the same behavior as tab click
        const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
        if (btn) btn.click();
        else this.switchTab(tabName, null);
        // Update location hash
        try { history.replaceState(null, '', '#' + (link.getAttribute('href') || '').replace('#','')); } catch (e) {}
      });
    });

    // Support hash navigation (back button / direct links)
    window.addEventListener('hashchange', () => {
      const tabName = mapHashToTab(location.hash);
      if (!tabName) return;
      const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
      if (btn) btn.click();
      else this.switchTab(tabName, null);
      navLinks.forEach(n => n.classList.toggle('active', n.getAttribute('href') === ('#' + (location.hash.replace('#','')))));
    });

    // If there's an initial hash, navigate to it
    if (location.hash) {
      const initialTab = mapHashToTab(location.hash);
      if (initialTab) {
        const btn = document.querySelector(`.tab-btn[data-tab="${initialTab}"]`);
        if (btn) btn.click();
        else this.switchTab(initialTab, null);
      }
    }

  }

  switchTab(tabName, event) {

    document.querySelectorAll('.tab-content').forEach(tab => {

      tab.classList.add('hidden');

    });

    document.querySelectorAll('.tab-btn').forEach(btn => {

      btn.classList.remove('active');

    });

    const selectedTab = document.getElementById(`${tabName}Tab`);

    if (selectedTab) {

      selectedTab.classList.remove('hidden');

    }

    if (event) {

      event.target.classList.add('active');

    }

    if (tabName === 'classes') this.renderClassesTab();
    if (tabName === 'users') this.renderUsersTab();
    if (tabName === 'students') this.renderStudentsTab();
    if (tabName === 'analytics') this.renderAnalyticsTab();

  }

  renderDashboard() {

    const mainContent = document.querySelector('.main-content');

    clearElement(mainContent);

    const header = document.createElement('div');

    header.className = 'flex-between mb-xl';

    header.innerHTML = `
      <div>
        <h1>GP Attendance Admin</h1>
        <p class="text-muted">Manage gathering place classes, users, and students</p>
      </div>
      <button id="logoutBtn" class="btn btn-secondary">Logout</button>
    `;

    mainContent.appendChild(header);

    const tabNav = document.createElement('div');

    tabNav.className = 'tab-navigation mb-lg';

    tabNav.innerHTML = `
      <button class="tab-btn active" data-tab="overview">Overview</button>
      <button class="tab-btn" data-tab="classes">Classes</button>
      <button class="tab-btn" data-tab="users">Leaders / Instructors</button>
      <button class="tab-btn" data-tab="students">Students</button>
      <button class="tab-btn" data-tab="analytics">Attendance Reports</button>
    `;

    mainContent.appendChild(tabNav);

    const tabContent = document.createElement('div');

    tabContent.innerHTML = `
      <div id="overviewTab" class="tab-content"></div>
      <div id="classesTab" class="tab-content hidden"></div>
      <div id="usersTab" class="tab-content hidden"></div>
      <div id="studentsTab" class="tab-content hidden"></div>
      <div id="analyticsTab" class="tab-content hidden"></div>
    `;

    mainContent.appendChild(tabContent);

    this.renderOverviewTab();

  }

  renderOverviewTab() {

    const tab = document.getElementById('overviewTab');

    clearElement(tab);

    const stats = document.createElement('div');

    stats.className = 'flex gap-lg flex-wrap';

    stats.appendChild(createStatCard('Classes', this.classes.length));

    stats.appendChild(createStatCard('Leaders/Instructors', this.users.length));

    stats.appendChild(createStatCard('Students', this.students.length));

    tab.appendChild(stats);

  }

  async renderClassesTab() {

    const tab = document.getElementById('classesTab');

    clearElement(tab);

    const header = document.createElement('div');
    header.className = 'flex-between mb-lg';
    header.innerHTML = `
      <h2>Classes</h2>
      <button class="btn btn-primary" id="addClassBtn">Add Class</button>
    `;

    tab.appendChild(header);

    const rows = this.classes.map(cls => {

      const instructor = this.users.find(u => u.id === cls.instructorId);

      return {

        'Class Name': cls.name,

        'Instructor': instructor ? instructor.name : 'Unassigned',

        'Status': cls.isLocked ? '🔒 Locked' : '🔓 Unlocked',

        'Actions': () => {

          const btn = document.createElement('button');

          btn.className = 'btn btn-small btn-secondary';

          btn.textContent = cls.isLocked ? 'Unlock' : 'Lock';

          btn.addEventListener('click', async () => {

            try {

              await updateClassLockStatus(cls.id, !cls.isLocked);

              await this.loadClasses();

              this.renderClassesTab();

              showNotification('Class updated', 'success');

            } catch {

              showNotification('Failed to update class', 'error');

            }

          });

          return btn;

        }

      };

    });

    const table = createTable(
      ['Class Name', 'Instructor', 'Status', 'Actions'],
      rows
    );

    tab.appendChild(table);

    document
      .getElementById('addClassBtn')
      ?.addEventListener('click', () => this.showAddClassModal());

  }

  showAddClassModal() {

    const nameInput = createInput('text','Class Name','className');

    const form = document.createElement('div');

    form.append(nameInput);

    let modal;

    const createBtn = createButton('Create Class', async () => {

      const name = nameInput.value && nameInput.value.trim();

      if (!name) {

        showNotification('Please provide a class name','warning');

        return;

      }

      try {

        await createClass(name);

        modal.remove();

        await this.loadClasses();

        this.renderClassesTab();

        showNotification('Class created successfully','success');

      } catch (err) {

        console.error(err);

        showNotification('Failed to create class','error');

      }

    });

    const cancelBtn = createButton('Cancel', () => modal.remove());

    modal = createModal('Add New Class', form, [createBtn, cancelBtn]);

    document.body.appendChild(modal);

  }

  async renderUsersTab() {

    const tab = document.getElementById('usersTab');

    clearElement(tab);

    const header = document.createElement('div');

    header.className = 'flex-between mb-lg';

    header.innerHTML = `
      <h2>Leaders / Instructors</h2>
      <button class="btn btn-primary" id="addUserBtn">Add User</button>
    `;

    tab.appendChild(header);

    const rows = this.users.map(user => ({

      'Name': user.name,

      'Email': user.email,

      'Role': user.role,

      'Class': user.assignedClassId || user.assignedClass || '—',

      'Actions': () => {

        const btn = document.createElement('button');

        btn.className = 'btn btn-danger btn-small';

        btn.textContent = 'Delete';

        btn.addEventListener('click', async () => {

          if (!confirm('Delete this user?')) return;

          try {

            await deleteUser(user.id);

            await this.loadUsers();

            this.renderUsersTab();

            showNotification('User deleted', 'success');

          } catch {

            showNotification('Failed to delete user', 'error');

          }

        });

        return btn;

      }

    }));

    const table = createTable(
      ['Name','Email','Role','Class','Actions'],
      rows
    );

    tab.appendChild(table);

    document
      .getElementById('addUserBtn')
      ?.addEventListener('click', () => this.showAddUserModal());

  }

  async renderStudentsTab(){

    const tab = document.getElementById('studentsTab');

    clearElement(tab);

    const header = document.createElement('div');

    header.className = 'flex-between mb-lg';

    header.innerHTML = `
      <h2>Students</h2>
      <button class="btn btn-primary" id="addStudentBtn">Add Student</button>
    `;

    tab.appendChild(header);

    const rows = this.students.map(student=>{

      const cls = this.classes.find(c=>c.id===student.classId);

      return{

        'Name':student.name,

        'Class':cls ? cls.name : 'Unassigned',

        'Actions':()=>{

          const btn=document.createElement('button');

          btn.className='btn btn-danger btn-small';

          btn.textContent='Delete';

          btn.addEventListener('click',async()=>{

            if(!confirm('Delete student?')) return;

            await deleteStudent(student.id);

            await this.loadStudents();

            this.renderStudentsTab();

          });

          return btn;

        }

      }

    });

    const table=createTable(['Name','Class','Actions'],rows);

    tab.appendChild(table);

    document
      .getElementById('addStudentBtn')
      ?.addEventListener('click',()=>this.showAddStudentModal());

  }

  showAddStudentModal(){

    const nameInput=createInput('text','Student Name','studentName');

    const classSelect=createSelect([

      {label:'Select Class...',value:''},

      ...this.classes.map(c=>({label:c.name,value:c.id}))

    ],'studentClass');

    const form=document.createElement('div');

    form.append(nameInput,classSelect);

    let modal;

    const createBtn=createButton('Add Student',async()=>{

      const name=nameInput.value;

      const classId=classSelect.value;

      if(!name || !classId){

        showNotification('Fill all fields','warning');

        return;

      }

      await addStudent(name,classId);

      modal.remove();

      await this.loadStudents();

      this.renderStudentsTab();

      showNotification('Student added','success');

    });

    const cancelBtn=createButton('Cancel',()=>modal.remove());

    modal=createModal('Add Student',form,[createBtn,cancelBtn]);

    document.body.appendChild(modal);

  }

  async renderAnalyticsTab() {

    const tab = document.getElementById('analyticsTab');

    clearElement(tab);

    const header = document.createElement('div');

    header.className = 'flex-between mb-lg';

    header.innerHTML = `
      <h2>Attendance Reports</h2>
      <button class="btn btn-secondary" id="printReportBtn">Print Report</button>
    `;

    tab.appendChild(header);

    const classSelect = createSelect(
      [{ label:'Select Class...', value:'' },
      ...this.classes.map(c => ({ label:c.name, value:c.id }))],
      'analyticsClassSelect'
    );

    tab.appendChild(classSelect);

    const container = document.createElement('div');

    tab.appendChild(container);

    classSelect.addEventListener('change', async (e) => {

      const classId = e.target.value;

      if (!classId) return;

      const stats = await calculateAttendanceStats(classId);

      clearElement(container);

      const rows = Object.values(stats.studentStats).map(stat => ({

        'Student': stat.name,

        'Present': stat.present,

        'Absent': stat.absent,

        'Total': stat.total,

        'Rate': stat.attendanceRate + '%'

      }));

      const table = createTable(
        ['Student','Present','Absent','Total','Rate'],
        rows
      );

      container.appendChild(table);

    });

    document
      .getElementById('printReportBtn')
      ?.addEventListener('click', triggerPrint);

  }

  showAddUserModal() {

    const nameInput = createInput('text','Full Name','userName');

    const emailInput = createInput('email','Email','userEmail');

    const passwordInput = createInput('password','Temporary Password','userPassword');

    const roleSelect = createSelect([
      {label:'Select role...',value:''},
      {label:'Instructor',value:'instructor'},
      {label:'Leader',value:'leader'}
    ],'userRole');

    const classSelect = createSelect([
      {label:'No Class',value:''},
      ...this.classes.map(c => ({label:c.name,value:c.id}))
    ],'userClass');

    const form = document.createElement('div');

    form.append(nameInput,emailInput,passwordInput,roleSelect,classSelect);

    let modal;

    const createBtn = createButton('Create User', async () => {

      const name = nameInput.value;
      const email = emailInput.value;
      const password = passwordInput.value;
      const role = roleSelect.value;
      const assignedClassId = classSelect.value;

      if(!name || !email || !password || !role){

        showNotification('Please fill all required fields','warning');

        return;

      }

      try{

        const secondaryApp = getApps().find(app => app.name === 'admin-user-creator') || initializeApp(firebaseConfig, 'admin-user-creator');
        const secondaryAuth = getAuth(secondaryApp);

        const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);

        await signOutSecondaryAuth(secondaryAuth);

        const uid = cred.user.uid;

        await setDoc(doc(db,'users',uid),{
          name,
          email,
          role,
          assignedClassId: assignedClassId || null,
          createdAt: serverTimestamp()
        });

        modal.remove();

        await this.loadUsers();

        this.renderUsersTab();

        showNotification('User created successfully','success');

      }catch(err){

        console.error('Create user failed:', err);
        showNotification(`Failed to create user: ${err.message || 'Unknown error'}`,'error');

      }

    });

    const cancelBtn = createButton('Cancel',()=>modal.remove());

    modal = createModal(
      'Add New User',
      form,
      [createBtn,cancelBtn]
    );

    document.body.appendChild(modal);

  }

}

AuthService.onAuthStateChanged(async (user) => {

  if (!user) {
    window.location.href = "../index.html";
    return;
  }

  const allowed = await AuthService.requireRole("admin");
  if (!allowed) return;

  const dashboard = new AdminDashboard();
  await dashboard.init(user);

});
