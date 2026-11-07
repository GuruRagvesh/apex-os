import { CODE_OF_CONDUCT } from './code-of-conduct.content';

export type PolicyPublicationState = 'PUBLISHED' | 'HOLD' | 'REFERENCE';

export type PolicyCatalogItem = {
  key: string;
  code: string;
  title: string;
  sourceIds: string[];
  summary: string;
  guidance: string;
  state: PolicyPublicationState;
  stateReason?: string;
  rules: string[];
  process: string[];
  examples: string[];
  owner: string;
  domain: 'COMPANY';
  version?: number;
  canonicalKey?: string;
  canonicalSection?: string;
  documentSections?: typeof CODE_OF_CONDUCT;
};

export type PolicyCatalogSection = {
  key: string;
  code: string;
  title: string;
  description: string;
  items: PolicyCatalogItem[];
};

const item = (
  code: string,
  title: string,
  sourceIds: string[],
  summary: string,
  guidance: string,
  state: PolicyPublicationState = 'PUBLISHED',
  stateReason?: string,
): PolicyCatalogItem => ({
  key: `policy-${code.replace('.', '-')}`,
  code,
  title,
  sourceIds,
  summary,
  guidance,
  state,
  stateReason,
  rules: [],
  process: [],
  examples: [],
  owner: 'People Operations',
  domain: 'COMPANY',
});

/**
 * Employee-safe policy catalogue based on the supplied policy pack. This is a
 * publication layer only: it does not turn any statement into an operational
 * attendance, leave, payroll or disciplinary rule.
 */
const POLICY_CENTER_CATALOG_BASE: PolicyCatalogSection[] = [
  {
    key: 'people-employment', code: '01', title: 'People & employment',
    description: 'Joining, employee records, role changes and policy acknowledgements.',
    items: [
      item('01.01', 'Joining, identity & probation', ['1.1', '1.2', '1.3'], 'Your employment record starts with verified joining information and required documents.', 'Keep your personal and employment details accurate. HR will explain any probation terms that apply to your role.'),
      item('01.02', 'Roles, departments & transfers', ['1.4', '1.5'], 'Role, department and reporting changes are recorded with an effective date.', 'A transfer is reviewed for its impact on access, open work and approvals before it takes effect.'),
      item('01.03', 'Deactivation & reactivation', ['1.6'], 'Access changes follow an authorized employment lifecycle decision.', 'A deactivated account cannot be used. Rejoining is handled as an authorized lifecycle event, not by reusing credentials.'),
      item('01.04', 'Records & corrections', ['9.1', '9.2'], 'You can request correction of inaccurate permitted employment records.', 'A correction request retains the original value, requested value, reviewer, reason and time of decision.'),
      item('01.05', 'Policy acknowledgement', ['9.3'], 'Acknowledging a policy records that you have read the published version.', 'Acknowledgement records the version and date. It does not replace any statutory right or contract term.'),
      item('01.06', 'Archives, retention & legal holds', ['9.4', '9.5', '9.6', '9.7'], 'Company records are retained and archived under authorized retention rules.', 'Past policy versions and completed decisions are preserved. A legal hold can pause deletion where required.'),
    ],
  },
  {
    key: 'attendance-leave', code: '02', title: 'Attendance, leave & working time',
    description: 'Working calendars, attendance evidence, leave, Comp Off and absence review.',
    items: [
      item('02.01', 'Working calendar & shifts', ['2.1', '2.2', '2.3'], 'The proposed working calendar is Monday–Friday plus first, third and fifth Saturdays.', 'Shift timing and calendar changes must be published with an effective date. Your assigned schedule remains the source for day-to-day work.'),
      item('02.02', 'Attendance classification & late arrivals', ['2.4', '2.7'], 'Attendance classifications and late-arrival review require approved, effective-dated rules.', 'This page does not calculate deductions or penalties. Any classification must be reviewable with an auditable reason.'),
      item('02.03', 'Punch, photo, location & device evidence', ['2.5', '2.6'], 'Live photo, location and device evidence may be required only when formally enabled and communicated.', 'Evidence collection must be proportionate, transparent and secured. This catalogue does not activate tracking.'),
      item('02.04', 'Attendance corrections', ['2.8'], 'Attendance corrections require a reason and supporting evidence where applicable.', 'Employees can request a correction; an authorized reviewer decides it and the decision is retained in the audit trail.'),
      item('02.05', 'Leave allocation, usage & holidays', ['3.1'], 'The policy pack proposes one annual paid-leave balance of 14 days, with leave beyond the balance treated as unpaid.', 'This is policy guidance only until HR approves and publishes an effective-dated leave configuration. Current operational leave rules continue to apply.'),
      item('02.06', 'Comp Off', ['3.2'], 'Comp Off is earned, approved, credited and expired separately from annual leave.', 'Eligibility, approval and expiry must be visible before a credit is used. This page does not issue or consume credits.'),
      item('02.07', 'Absence & unpaid leave', ['3.3'], 'Unreported absence may require review before it is classified as unpaid leave.', 'No automatic punitive outcome is created by this policy library. Employees must have a way to provide evidence or request correction.'),
    ],
  },
  {
    key: 'work-tickets-performance', code: '03', title: 'Work, tickets & performance',
    description: 'Work ownership, ticket flow, approval, service expectations and human performance review.',
    items: [
      item('03.01', 'Work & ticket categories', ['4.1', '4.2'], 'Tickets capture the work requested, category, priority, expected output and ownership.', 'Authorized administrators maintain task categories and templates. Tickets should make work expectations clear to the assignee.'),
      item('03.02', 'Assignment & approval', ['4.3', '4.4'], 'Work assignment and approval follow authorized department and reporting scope.', 'An assignee should be able to see the work owner, approver and due date. Access alone does not determine company hierarchy.'),
      item('03.03', 'Ticket lifecycle', ['4.5'], 'Tickets move through a visible lifecycle with accountable hand-offs.', 'Changes to ownership, status and due dates should remain visible in the ticket history.'),
      item('03.04', 'Service levels, escalation & review', ['4.6'], 'Service targets and escalation paths are configured organization rules.', 'Current service-level settings remain controlled by their existing approved workflow; this library is not an SLA editor.'),
      item('03.05', 'Quality & performance review', ['4.7'], 'Work evidence can support a human quality or performance review.', 'The system must not create automatic punitive outcomes from activity, ticket or attendance data.'),
    ],
  },
  {
    key: 'conduct-security', code: '04', title: 'Conduct, compliance & security',
    description: 'Professional conduct, confidential reporting, access protection and security response.',
    items: [
      item('04.01', 'Conduct & ethics', ['5.1', '5.2'], 'Employees are expected to act professionally, accurately and respectfully.', 'Concerns should be raised through an authorized company channel and handled with appropriate confidentiality.'),
      item('04.02', 'Conflicts & gifts', ['5.3'], 'Actual or potential conflicts of interest and gifts must be disclosed under company guidance.', 'Do not accept or offer anything that could improperly influence a business decision. Ask HR or an authorized manager when unsure.'),
      item('04.03', 'Grievance & discipline', ['5.4', '5.5'], 'A grievance or disciplinary matter requires a responsible reviewer, evidence and a fair response process.', 'No automated disciplinary finding is made by Apex OS. Authorized people make documented decisions and provide an appeal route where applicable.'),
      item('04.04', 'Respectful workplace & POSH', ['5.6', '5.7'], 'The company is committed to a respectful workplace and clear public-review standards.', 'Detailed POSH procedure is awaiting formal approval and a confidential reporting route.', 'HOLD', 'Awaiting formal approval and a confidential reporting procedure.'),
      item('04.05', 'NDA, intellectual property & access', ['6.1', '6.2', '6.3'], 'Confidential information, company intellectual property and access credentials must be protected.', 'Use access only for authorized work. Keep credentials private and report a suspected compromise promptly.'),
      item('04.06', 'Internet, email, USB & device security', ['6.4', '6.5', '6.6'], 'Use company systems responsibly and follow approved information-security practices.', 'Technical controls are only represented when an actual managed-device integration exists; this policy does not claim undeployed monitoring.'),
      item('04.07', 'Security incident management', ['6.7'], 'Security incidents should be reported quickly so evidence can be protected and impact contained.', 'Only authorized investigators access incident details. Communications are controlled to protect affected people and the organization.'),
    ],
  },
  {
    key: 'assets-travel-expenses', code: '05', title: 'Assets, travel & expenses',
    description: 'Issued assets, business travel, expense reimbursement and fair recovery boundaries.',
    items: [
      item('05.01', 'Assets & ID', ['7.1'], 'Issued company assets and identification are assigned to an accountable custodian.', 'Keep issued items secure and notify the company promptly if an item is lost, damaged or no longer needed.'),
      item('05.02', 'Asset use, return & clearance', ['7.2', '7.3'], 'Company assets must be used appropriately and returned through an evidenced clearance process.', 'A return or clearance record should identify the item, condition and handover. Do not rely on verbal-only completion.'),
      item('05.03', 'Business travel', ['7.4'], 'Business travel requires an approved purpose, dates and accountable approver.', 'Travel approval and evidence requirements are published policy until a dedicated travel workflow is available.'),
      item('05.04', 'Expense reimbursement', ['7.5'], 'Eligible expenses require receipts, submitted details, approval and finance review.', 'Limits, deadlines and payment status must be communicated by Finance. This library does not submit or pay claims.'),
      item('05.05', 'Recovery & system boundaries', ['7.6', '7.7'], 'Any recovery requires itemized evidence, employee response and authorized approval.', 'Until dedicated asset, travel and expense workflows exist, Apex OS provides policy publication and acknowledgement only.'),
    ],
  },
  {
    key: 'payroll-separation', code: '06', title: 'Payroll, salary & separation',
    description: 'Payroll inputs, notice, resignation, clearance and final settlement safeguards.',
    items: [
      item('06.01', 'Payroll attendance inputs', ['8.1'], 'Payroll uses approved attendance, leave, unpaid-leave and correction decisions.', 'Excluded or adjusted days must be reviewable before payroll is finalized. This library does not calculate pay.'),
      item('06.02', 'Payroll-month administration', ['8.2'], 'Payroll work is governed through controlled preparation, review, finalization and release stages.', 'Payroll records and access remain restricted to authorized roles and retain an audit trail.'),
      item('06.03', 'Notice & release', ['8.3', '8.4'], 'Notice and early-release decisions require authorized review.', 'The applicable employment terms and approved decision determine any notice outcome; no automated penalty is created here.'),
      item('06.04', 'Resignation & withdrawal', ['8.5'], 'Resignation and withdrawal requests follow a documented employee and company workflow.', 'The company records the request, relevant approvals and communicated outcome without silently changing historical information.'),
      item('06.05', 'Final settlement & holds', ['8.6', '8.7'], 'Final settlement and clearance are controlled processes with supporting evidence.', 'A legitimate hold must be documented, limited and reviewed by authorized people. Do not treat a system flag as a final decision.'),
      item('06.06', 'Payroll & settlement adjustments', ['8.8'], 'Payroll and settlement adjustments require an auditable authorized decision.', 'Employees should receive an understandable explanation for an approved adjustment. This page does not make adjustments.'),
    ],
  },
];

type PolicyReaderContent = Pick<PolicyCatalogItem, 'rules' | 'process' | 'examples' | 'owner'>;

/** Detailed employee-facing text. It mirrors the supplied source policy pack,
 * without treating any unapproved rule as executable system configuration. */
const POLICY_READER_CONTENT: Record<string, PolicyReaderContent> = {
  '01.01': { owner: 'People Operations', rules: ['Every employment record needs a joining date, employment type, department, designation, reporting manager, Team Lead where applicable and required onboarding documents.', 'Employee IDs are system-generated, cannot be edited or reused, and returning employees receive a new employment ID.', 'Probation, confirmation date and any approved extension are recorded for use in employment conditions.'], process: ['Provide requested joining and identity information to HR.', 'HR completes missing setup rather than silently activating an incomplete record.', 'Raise a correction request if a permitted record is inaccurate.'], examples: ['A returning employee receives a new ID; their earlier employment history remains archived and linked only as permitted.'] },
  '01.02': { owner: 'People Operations', rules: ['Designation is a job title; system role controls access; department membership controls where that access applies.', 'A person may belong to more than one department and hold different department-specific assignments.', 'Every department transfer has an effective date, prior and new department, reporting manager and impact review.'], process: ['An authorized HR, Admin or Super Admin records the change.', 'Open tickets, approvals, leave routing and access are reviewed before the effective date.', 'The earlier assignment remains auditable.'], examples: ['An employee can lead QC while retaining a separate assignment in Retail Business.'] },
  '01.03': { owner: 'People Operations', rules: ['Deactivation removes system access without deleting employment history.', 'Reactivation requires authorized review and retains the complete audit history.'], process: ['HR or an authorized administrator reviews the employment decision.', 'Access is changed through the lifecycle workflow, never by deleting the person record.'], examples: ['A temporary access interruption does not erase tickets, attendance or approved employment records.'] },
  '01.04': { owner: 'People Operations', rules: ['Employees can see their permitted records; sensitive payroll, evidence and documents remain restricted.', 'A correction retains original value, requested value, reviewer, reason, decision and timestamp.'], process: ['Submit the correction with a clear reason and any requested evidence.', 'An eligible reviewer records the outcome.', 'The decision appears in your history where permitted.'], examples: ['Correcting an address creates a traceable correction instead of silently replacing the previous record.'] },
  '01.05': { owner: 'People Operations', rules: ['An acknowledgement records the exact issued policy version, viewed/acknowledged status and date.', 'Acknowledgement confirms review; it does not waive statutory rights or replace an employment contract.'], process: ['Open the complete published policy.', 'Read its rules and examples.', 'Use the acknowledgement action at the end of the document.'], examples: ['A later policy revision needs its own acknowledgement; the earlier acknowledgement is preserved.'] },
  '01.06': { owner: 'People Operations & Compliance', rules: ['Employment records are archived in a verified private location for the approved retention duration.', 'Legal or investigation holds block destructive deletion until an authorized release.', 'Completed decisions and previous policy versions are never silently overwritten.'], process: ['Request records through the approved HR channel.', 'Compliance reviews retention and legal-hold status before any deletion action.'], examples: ['An archived employee account can be inaccessible while its employment history remains retained.'] },
  '02.01': { owner: 'People Operations', rules: ['Working days are Monday–Friday plus the first, third and fifth Saturdays; Sundays and second/fourth Saturdays are weekly offs.', 'Approved holiday calendars are published by HR/Admin.', 'Each employee has an applicable shift start, end, grace period and work-mode/category rule; changes are effective-dated.'], process: ['Check your assigned schedule and the published holiday calendar.', 'Ask HR before relying on a calendar exception.', 'Future schedule changes are published rather than overwriting historical schedules.'], examples: ['If a month has five Saturdays, the first, third and fifth are scheduled working days.'] },
  '02.02': { owner: 'People Operations', rules: ['A full day requires the approved nine hours of work.', 'Up to 4.5 hours worked is a half day; arrival at or after 1:00 PM with a 6:30 PM completion is also a half day.', 'More than 4.5 and fewer than nine hours is early check-out/late punch-in unless the half-day rule applies; its proposed one-third pay effect needs approved, effective-dated legal review.'], process: ['Attendance is calculated from approved punch and work-time data.', 'HR may correct a result only with valid evidence and an auditable reason.', 'Any absence outcome beyond these classifications needs an authorized decision.'], examples: ['Punching in at 9:30 AM and leaving at 4:00 PM is recorded as a half day, not two separate violations.'] },
  '02.03': { owner: 'People Operations & Security', rules: ['When enabled, punch-in and punch-out require live photo, latitude, longitude, location accuracy and geofence validation.', 'Device ID, type and capture channel are stored. If unavailable, UNKNOWN and DEVICE_ID_UNAVAILABLE are recorded.', 'A valid photo/location punch can proceed when device ID is unavailable, then goes to HR review without automated notifications.'], process: ['Allow the requested evidence only when the approved attendance policy is active.', 'Read any failure reason shown before retrying.', 'Use attendance correction only for eligible correction types.'], examples: ['A device that cannot expose its identifier should not block an otherwise valid photo and location punch.'] },
  '02.04': { owner: 'People Operations', rules: ['Missing/incorrect punch-in or punch-out share one correction request per employee per month.', 'Incorrect attendance status permits up to three requests per employee per month.', 'Location flags, worked-hours disputes and photo problems are not separate correction request types.'], process: ['Choose the eligible correction type and provide the reason/evidence.', 'An eligible TL, Manager, HR or Admin decides according to department authority.', 'The system rechecks current attendance before applying a decision and does not overwrite finalized payroll without a new reviewed request.'], examples: ['A missed punch-out and an incorrect punch-in in the same month consume the combined punch-correction limit.'] },
  '02.05': { owner: 'People Operations', rules: ['Every employee receives one annual balance of 14 leave days; there are no Casual, Sick or Emergency leave categories.', 'The first 14 approved leave days are paid. Leave beyond that balance is unpaid and itemized before payroll finalization.', 'Late planned-leave requests remain reviewable and must not automatically create salary deductions, forced work or punitive outcomes.'], process: ['Submit leave with the relevant dates and available context.', 'Review allocated, used, pending, remaining and expired balance.', 'The authorized approver records a decision.'], examples: ['An employee may use the single leave balance for illness or personal work without selecting a leave category.'] },
  '02.06': { owner: 'People Operations', rules: ['Comp Off is earned, approved, credited and expired separately from annual leave.', 'Twelve hours in one day creates an option to apply for a three-hour Comp Off; fewer than three extra hours is not eligible.', 'Twelve hours on each of three consecutive days earns one full Comp Off day. Thresholds require effective-dated approval.'], process: ['Review qualifying extra hours.', 'Apply for Comp Off through the authorized workflow.', 'Use only an approved, unexpired credit.'], examples: ['A nine-hour standard day plus two extra hours does not qualify for the three-hour Comp Off option.'] },
  '02.07': { owner: 'People Operations', rules: ['Three consecutive scheduled working days with no punch, leave, evidence or recorded information may be reviewed as LWP.', 'HR can correct an LWP outcome only with valid evidence and an auditable reason.'], process: ['If you are absent, use the leave or evidence process as soon as possible.', 'Provide evidence during an authorized review.', 'Payroll impact is reviewed under the approved decision path.'], examples: ['A holiday or weekly off does not count as one of the three scheduled working days.'] },
  '03.01': { owner: 'Operations', rules: ['Tickets define assigned work, priority, due date, expected output, follow-up responsibility and reporting responsibility.', 'Authorized admins maintain task types, subtypes, departments, templates and request purposes.', 'Categories remain visible to employees during ticket creation.'], process: ['Select the best matching category when creating work.', 'Use a clear expected output and due date.', 'Ask an authorized admin to correct a missing category.'], examples: ['A training-delivery request can use a department-specific ticket category without exposing unrelated administration categories.'] },
  '03.02': { owner: 'Operations', rules: ['Assignment authority must state who can assign to themselves, individuals, teams, departments or cross-functional reviewers.', 'Approval follows a department-specific assignment, not only a person’s global role.'], process: ['The assigner identifies owner, reviewer and accountable department.', 'The assigned employee can see the work expectation and route.', 'Escalate an incorrect route to the authorized manager.'], examples: ['A QC Team Lead may review QC work while holding a different role in Retail Business.'] },
  '03.03': { owner: 'Operations', rules: ['Ticket transitions define the approved use of Pending Approval, Open, In Progress, Under Review, Done, Closed, Rework, Reopen, Withdrawal and cancellation.', 'Ticket history preserves status, assignment and due-date changes.'], process: ['Move a ticket only through permitted states.', 'Use the review state when work needs verification.', 'Use reopening or rework with a clear reason.'], examples: ['Closing a ticket does not erase the earlier review, rework or approval history.'] },
  '03.04': { owner: 'Operations', rules: ['The SLA policy defines execution and review time, overdue calculation, escalation and accountable owner.', 'Service-level values require approved configuration and cannot be changed from this library.'], process: ['Check the ticket’s target and escalation route.', 'Escalate through the defined owner when a target is at risk.', 'Use ticket history for review, not informal assumptions.'], examples: ['Execution time and review time can have separate targets for the same ticket.'] },
  '03.05': { owner: 'Operations & People Operations', rules: ['Ticket history, work time, review outcome and ratings may support human performance review.', 'These records must not automatically punish, terminate, blacklist or deduct salary from an employee.'], process: ['Review the complete work context with an authorized person.', 'Give employees a chance to provide context where a review affects them.', 'Record human decisions and reasons.'], examples: ['A low rating is evidence for a conversation, not an automatic salary adjustment.'] },
  '04.01': { owner: 'People Operations', rules: ['Maintain professional behaviour, reliable communication, attendance responsibility and compliance with approved procedures.', 'Provide accurate information, avoid misuse of authority and do not falsify attendance, work, expenses or records.'], process: ['Raise a concern through an approved channel.', 'Cooperate with an authorized review.', 'Use factual, respectful communication.'], examples: ['Correcting an accidental record promptly is different from knowingly falsifying one.'] },
  '04.02': { owner: 'People Operations', rules: ['Disclose potential conflicts of interest and material gifts.', 'The system does not automatically presume a violation from a disclosure.'], process: ['Describe the possible conflict or gift to the authorized management contact.', 'Wait for the documented guidance before taking a related business decision.'], examples: ['A vendor invitation that could influence a purchasing decision should be disclosed for review.'] },
  '04.03': { owner: 'People Operations', rules: ['Employees can submit a grievance, receive a responsible reviewer, use an escalation path and receive a confidential closure decision.', 'Discipline requires an allegation, evidence, employee response opportunity, authorized investigation, decision and appeal path.', 'No automated disciplinary finding is permitted.'], process: ['Use the approved reporting channel.', 'Provide factual information and preserve relevant evidence.', 'The assigned reviewer records the decision and next steps.'], examples: ['A dashboard or attendance flag cannot by itself be treated as a disciplinary decision.'] },
  '04.04': { owner: 'People Operations & Legal', rules: ['Public or negative reviews are handled through policy acknowledgement and manual HR incident reporting; private social-media accounts are not monitored.', 'Anti-harassment, non-discrimination, anti-retaliation and POSH complaint procedures require an approved company legal policy.'], process: ['Use the designated confidential channel when it is formally published.', 'Do not use this general policy reader as an emergency reporting route.'], examples: ['The detailed POSH process remains unavailable until the approved legal document and reporting route are supplied.'] },
  '04.05': { owner: 'Security & Legal', rules: ['Protect confidential company, client, employee, training, financial and business information during and after employment.', 'Company source code, designs, documents, data, training material and deliverables are used only under approved company terms.', 'Access is limited to the employee’s authorized company, department, team, role and employee scope.'], process: ['Use information only for an approved business purpose.', 'Report mistaken access or disclosure promptly.', 'Ask for access through the authorized route rather than sharing credentials.'], examples: ['Admin access is a work privilege and does not create a business-reporting relationship.'] },
  '04.06': { owner: 'Security', rules: ['Company systems are for approved business use; suspected misuse follows documented reporting and review.', 'External-storage exceptions are requested where needed; Apex OS does not claim to block USB devices without a real device-management integration.', 'Passwords, sessions, MFA where enabled and company devices must be protected; account sharing is prohibited.'], process: ['Use approved systems and protect your session.', 'Report a lost or compromised device promptly.', 'Request a documented exception for external storage when necessary.'], examples: ['A warning policy does not mean the application can technically block a USB device.'] },
  '04.07': { owner: 'Security', rules: ['Security incidents require reporting, evidence preservation, authorized investigation, corrective action and controlled disclosure.', 'Findings remain human-reviewed.'], process: ['Report the incident promptly using the authorized security route.', 'Do not alter relevant evidence unless directed for containment.', 'Follow the assigned incident owner’s instructions.'], examples: ['A suspected account compromise should be reported immediately, even before all details are known.'] },
  '05.01': { owner: 'People Operations & IT', rules: ['Issued laptops, phones, accessories, ID cards, documents, software access, issue date, custodian and acknowledgement are recorded.'], process: ['Verify issued items at handover.', 'Keep acknowledgements and report discrepancies promptly.'], examples: ['Software access can be recorded as an issued business asset alongside physical equipment.'] },
  '05.02': { owner: 'People Operations & IT', rules: ['Assets are for approved business use. Employees use reasonable care and report loss, damage, theft or malfunction.', 'Exit clearance records return status, evidence, responsible owner, unresolved item and authorized closure.'], process: ['Report an issue as soon as it occurs.', 'Return assets through the assigned clearance owner.', 'Retain handover evidence where provided.'], examples: ['A returned laptop is not cleared until its condition and handover evidence are recorded.'] },
  '05.03': { owner: 'People Operations & Finance', rules: ['Business travel requires approved purpose, dates, approver, permitted booking method and supporting evidence.', 'This Policy Center publishes the rule only; it does not create fake travel-booking automation.'], process: ['Obtain required approval before booking or travelling.', 'Keep the supporting evidence requested by the travel procedure.'], examples: ['A customer-site visit requires a business purpose and authorized approver before reimbursement review.'] },
  '05.04': { owner: 'Finance', rules: ['Expense rules define eligible types, limits, receipt requirement, submission deadline, approving authority, finance review and payment status.', 'This library does not submit, approve or pay claims.'], process: ['Keep receipts and submit them through the approved finance process.', 'Review the recorded approval and payment status.'], examples: ['A receipt may be required even where an expense is within a permitted category.'] },
  '05.05': { owner: 'Finance & People Operations', rules: ['Missing or damaged assets may create a review, but a monetary recovery needs itemized evidence, employee response opportunity and authorized approval.', 'Travel and expense capabilities remain policy-and-acknowledgement only until dedicated workflows are approved.'], process: ['Respond to a recovery review with relevant facts or evidence.', 'Wait for an authorized decision before treating a review as final.'], examples: ['An unresolved asset cannot automatically forfeit all salary or final settlement.'] },
  '06.01': { owner: 'Finance & People Operations', rules: ['Payroll uses approved attendance, leave, LWP, correction decisions and unresolved-day status.', 'Any excluded day is visible before payroll finalization.'], process: ['Review employee-safe payroll explanations where provided.', 'Raise a correction through the authorized attendance/HR route before finalization.'], examples: ['A pending attendance correction should be visible as unresolved rather than silently treated as final.'] },
  '06.02': { owner: 'Finance', rules: ['Payroll month statuses are Open, Reviewing, Finalized and Sent.', 'Only HR and Admin may edit, assign, finalize or send payroll and notice-period records; Accounts Admin is not a separate role.'], process: ['Payroll operators follow the controlled review stages.', 'Employees use the approved HR/Finance route for questions rather than changing payroll data.'], examples: ['An employee in Accounts without an Admin role does not gain payroll administration access.'] },
  '06.03': { owner: 'People Operations & Finance', rules: ['Notice period depends on recorded level unless an approved contract or authorized adjustment applies: 30 days for Team Lead/similar senior-manager-and-below levels, 60 days above senior manager, 15 days for employees and 7–15 days for interns.', 'Only HR and Admin can assign or change notice periods.', 'Early release requires an authorized decision and audit trail.'], process: ['Submit a resignation or early-release request through the authorized process.', 'HR/Admin records the approved last working day and recalculates notice and settlement.'], examples: ['A request to leave today is not final until HR or authorized Admin approves the new last working day.'] },
  '06.04': { owner: 'People Operations', rules: ['Resignation records resignation date, intended/approved last working day, notice calculation, handover and any withdrawal before the last working day.'], process: ['Submit the request through the approved channel.', 'Complete requested handover and clearance steps.', 'Keep the documented decision for withdrawal or date changes.'], examples: ['Withdrawing a resignation before the last working day still requires a recorded authorized outcome.'] },
  '06.05': { owner: 'Finance & People Operations', rules: ['Final settlement shows earned salary, approved attendance/leave effect, outstanding amounts, approved adjustments, settlement status and an employee-safe explanation.', 'Unresolved notice, assets, clearance or approved documentation can create ON_HOLD_REVIEW_REQUIRED.', 'A hold must not automatically forfeit all salary or settlement.'], process: ['Review the settlement explanation.', 'Provide requested evidence for an unresolved item.', 'Use the authorized appeal or clarification route for disputed items.'], examples: ['A missing asset can trigger review, but it requires itemized evidence and authorized handling.'] },
  '06.06': { owner: 'Finance & People Operations', rules: ['Attendance, asset, misconduct and notice adjustments are separately itemized with reason, evidence, decision authority and audit trail.', 'No automatic blacklisting or punitive salary forfeiture is allowed.'], process: ['Request an explanation through the approved HR/Finance route.', 'An authorized person reviews the itemized decision and available evidence.'], examples: ['A salary adjustment cannot be inferred solely from an attendance flag without the required reviewed decision.'] },
};

const CONDUCT_TOPIC_SECTIONS: Record<string, string> = {
  '04.02': '4',
  '04.03': '7',
  '04.05': '8',
  '04.06': '6',
  '04.07': '6',
};

export const POLICY_CENTER_CATALOG: PolicyCatalogSection[] = POLICY_CENTER_CATALOG_BASE.map((section) => ({
  ...section,
  items: section.items.map((policy) => {
    if (policy.code === '04.01') {
      return {
        ...policy,
        title: 'Code of Conduct',
        summary: 'The company-wide standards for ethics, professional conduct, conflicts, security, speaking up and fair enforcement.',
        guidance: 'Read the complete Code of Conduct below. The related conduct topics in this library lead here, so you acknowledge this document once.',
        owner: "Founder’s Office & People Operations",
        rules: [], process: [], examples: [],
        version: 2,
        documentSections: CODE_OF_CONDUCT,
      };
    }
    if (CONDUCT_TOPIC_SECTIONS[policy.code]) {
      return {
        ...policy,
        state: 'REFERENCE' as const,
        canonicalKey: 'policy-04-01',
        canonicalSection: CONDUCT_TOPIC_SECTIONS[policy.code],
        guidance: 'This topic is covered by the company Code of Conduct.',
        rules: [], process: [], examples: [],
        owner: "Founder’s Office & People Operations",
      };
    }
    return { ...policy, ...POLICY_READER_CONTENT[policy.code] };
  }),
}));

export const POLICY_CATALOG_ITEMS = POLICY_CENTER_CATALOG.flatMap((section) => section.items.map((policy) => ({ ...policy, section: { key: section.key, code: section.code, title: section.title } })));

export const findPolicyCatalogItem = (key: string) => POLICY_CATALOG_ITEMS.find((policy) => policy.key === key);
