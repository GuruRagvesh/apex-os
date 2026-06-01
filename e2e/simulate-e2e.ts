import axios from 'axios';

const BASE_URL = 'http://localhost:3001/api';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

axios.interceptors.response.use(async (response) => {
  await sleep(250);
  return response;
}, async (error) => {
  await sleep(250);
  return Promise.reject(error);
});

async function login(email: string) {
  const res = await axios.post(`${BASE_URL}/auth/login`, {
    email,
    password: 'Apex@2026'
  });
  return { token: res.data.accessToken, user: res.data.user };
}

async function run() {
  console.log('--- STARTING E2E WORKFLOW TESTS ---');

  try {
    // WF1: Employee Ticket Execution
    console.log('\n[WF1] EMPLOYEE TICKET EXECUTION');
    const { token: empToken, user: empUser } = await login('pooja.kamble@technoedgels.com'); // EMPLOYEE
    const empApi = axios.create({ baseURL: BASE_URL, headers: { Authorization: `Bearer ${empToken}` } });

    await empApi.get('/dashboard/overview');
    
    // Create Ticket
    const ticketRes = await empApi.post('/tickets', {
      title: 'WF1 Test Ticket',
      description: 'Testing employee ticket flow',
      priority: 'HIGH',
      category: 'OPERATIONS'
    });
    const ticketId = ticketRes.data.id;
    console.log(`Ticket created: ${ticketId}`);

    // Update status
    await empApi.patch(`/tickets/${ticketId}`, { status: 'IN_PROGRESS' });
    console.log('Status updated to IN_PROGRESS');

    // Add comment
    await empApi.post(`/tickets/${ticketId}/comments`, { content: 'Starting work on this now.' });
    console.log('Comment added');

    // Submit for review
    await empApi.patch(`/tickets/${ticketId}`, { status: 'REVIEW' });
    console.log('Status updated to REVIEW');

    const refreshedTicket = await empApi.get(`/tickets/${ticketId}`);
    if (refreshedTicket.data.status !== 'REVIEW') throw new Error('Status did not persist!');
    console.log('Refresh: Status persisted correctly');

    const activityRes = await empApi.get('/dashboard/activity-feed');
    if (!activityRes.data.some((l: any) => l.action === 'TICKET_CREATED' && l.entityId === ticketId)) {
       throw new Error('Activity log missing create event');
    }
    console.log('Activity log verified');
    
    // Try to access unrelated ticket - we need another user's ticket. 
    console.log('WF1 SUCCESS');

    // WF2: Team Lead Review Flow
    console.log('\n[WF2] TEAM LEAD REVIEW FLOW');
    const { token: tlToken } = await login('Vishal@technoedgels.com'); // TEAM_LEAD in same dept (ID Team)
    const tlApi = axios.create({ baseURL: BASE_URL, headers: { Authorization: `Bearer ${tlToken}` } });

    await tlApi.get('/dashboard/overview');
    
    // Review the ticket from Employee
    const tlTicketRes = await tlApi.get(`/tickets/${ticketId}`);
    if (tlTicketRes.data.id !== ticketId) throw new Error('Could not see employee ticket');
    
    await tlApi.patch(`/tickets/${ticketId}`, { status: 'DONE' });
    await tlApi.post(`/tickets/${ticketId}/comments`, { content: 'Looks good.' });
    
    const refreshedTlTicket = await tlApi.get(`/tickets/${ticketId}`);
    if (refreshedTlTicket.data.status !== 'DONE') throw new Error('Status not DONE');
    console.log('WF2 SUCCESS');

    // WF4: Leave Request and Approval
    console.log('\n[WF4] LEAVE REQUEST FLOW');
    // Employee applies
    const offset = Math.floor(Math.random() * 300) + 10;
    const leaveRes = await empApi.post('/leave', {
      type: 'SICK',
      startDate: new Date(Date.now() + offset * 86400000).toISOString(),
      endDate: new Date(Date.now() + (offset + 1) * 86400000).toISOString(),
      reason: 'Not well'
    });
    const leaveId = leaveRes.data.id;
    console.log(`Leave requested: ${leaveId}`);
    
    // TL approves
    await tlApi.patch(`/leave/${leaveId}/approve`);
    console.log('Leave approved');
    
    const refreshedLeave = await empApi.get(`/leave`);
    console.log('Leaves returned:', refreshedLeave.data);
    const leavesList = Array.isArray(refreshedLeave.data) ? refreshedLeave.data : (refreshedLeave.data.items || refreshedLeave.data.data || []);
    const myLeave = leavesList.find((l:any) => l.id === leaveId);
    if (!myLeave || myLeave.status !== 'APPROVED') {
       console.log('myLeave:', myLeave);
       throw new Error('Leave status mismatch');
    }
    console.log('WF4 SUCCESS');

    // WF5: Workday / Attendance
    console.log('\n[WF5] WORKDAY FLOW');
    await empApi.post('/workday/start');
    await empApi.post('/workday/break/start', { breakType: 'LUNCH' });
    await empApi.post('/workday/break/end');
    await empApi.post('/workday/end');
    console.log('Workday flow executed');

    const tlTeam = await tlApi.get('/workday/team');
    if (!Array.isArray(tlTeam.data)) throw new Error('Team workday data invalid');
    console.log('WF5 SUCCESS');

    // WF6: Settings Profile
    console.log('\n[WF6] SETTINGS PROFILE');
    await empApi.patch('/users/me/preferences', { receiveEmailNotifications: false });
    const me = await empApi.get('/users/me/preferences');
    if (me.data?.receiveEmailNotifications !== false) throw new Error('Preferences not persisted');
    console.log('WF6 SUCCESS');

    // Direct URL Access Tests
    console.log('\n[DIRECT URL ACCESS TESTS]');
    let blocked = true;
    try { await empApi.get('/departments'); blocked = false; } catch (e: any) { if(e.response?.status !== 403) throw new Error('Wrong error code for departments'); }
    if (!blocked) throw new Error('Employee accessed departments');
    
    blocked = true;
    try { await empApi.patch('/settings/company', { name: 'Hacked' }); blocked = false; } catch (e: any) { }
    if (!blocked) throw new Error('Employee accessed company settings');
    
    console.log('Direct URL checks passed');

    console.log('\n--- ALL WORKFLOWS EXECUTED SUCCESSFULLY ---');

  } catch (error: any) {
    console.error('TEST FAILED:', error.response?.data || error.message);
  }
}

run();
