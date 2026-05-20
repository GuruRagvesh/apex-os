import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SeedEntry {
  typeName: string;
  subtypes: string[];
  deptName: string | null; // null = global
  isGlobal: boolean;
}

const SEED_DATA: SeedEntry[] = [
  // ── GLOBAL ────────────────────────────────────────────────────────────────
  { deptName: null, isGlobal: true, typeName: 'General', subtypes: ['Task', 'Request', 'Follow-up', 'Reminder', 'Miscellaneous'] },
  { deptName: null, isGlobal: true, typeName: 'IT Support', subtypes: ['Hardware Issue', 'Software Issue', 'Access Request', 'Network Issue'] },
  { deptName: null, isGlobal: true, typeName: 'Meeting', subtypes: ['Internal Meeting', 'External Meeting', 'Review Meeting', 'One-on-One'] },

  // ── ID Team ───────────────────────────────────────────────────────────────
  { deptName: 'ID Team', isGlobal: false, typeName: 'Content Development', subtypes: ['Module Writing', 'Storyboard', 'Script', 'Content Review', 'Final Draft'] },
  { deptName: 'ID Team', isGlobal: false, typeName: 'Design', subtypes: ['Visual Design', 'Graphic Asset', 'Animation Brief', 'Template Creation'] },
  { deptName: 'ID Team', isGlobal: false, typeName: 'Research', subtypes: ['Subject Research', 'SME Coordination', 'Reference Collection', 'Benchmarking'] },
  { deptName: 'ID Team', isGlobal: false, typeName: 'Review & QC', subtypes: ['Peer Review', 'Manager Review', 'Client Review', 'Revision'] },
  { deptName: 'ID Team', isGlobal: false, typeName: 'Project Coordination', subtypes: ['Brief', 'Timeline', 'Status Update', 'Handoff'] },

  // ── AI & Media Production ─────────────────────────────────────────────────
  { deptName: 'AI & Media Production', isGlobal: false, typeName: 'Pre-Production', subtypes: ['Concept', 'Script', 'Storyboard', 'Shot List', 'Resource Planning'] },
  { deptName: 'AI & Media Production', isGlobal: false, typeName: 'Production', subtypes: ['Shoot', 'Recording', 'Screen Capture', 'Voiceover'] },
  { deptName: 'AI & Media Production', isGlobal: false, typeName: 'Post-Production', subtypes: ['Video Editing', 'Audio Mixing', 'Color Grading', 'Subtitles', 'Thumbnail'] },
  { deptName: 'AI & Media Production', isGlobal: false, typeName: 'Publishing', subtypes: ['Upload', 'SEO Metadata', 'Distribution', 'Social Scheduling'] },
  { deptName: 'AI & Media Production', isGlobal: false, typeName: 'Review', subtypes: ['Internal Review', 'Client Feedback', 'Revision', 'Sign-off'] },

  // ── AI and R&D ────────────────────────────────────────────────────────────
  { deptName: 'AI and R&D', isGlobal: false, typeName: 'Research', subtypes: ['Literature Review', 'Dataset Collection', 'Benchmark Analysis', 'Documentation'] },
  { deptName: 'AI and R&D', isGlobal: false, typeName: 'Development', subtypes: ['Model Training', 'Fine-tuning', 'API Integration', 'Testing', 'Deployment'] },
  { deptName: 'AI and R&D', isGlobal: false, typeName: 'POC / Prototype', subtypes: ['Feasibility Study', 'Demo Build', 'POC Report', 'Presentation'] },
  { deptName: 'AI and R&D', isGlobal: false, typeName: 'Reporting', subtypes: ['Weekly Update', 'Research Summary', 'Technical Report', 'Presentation'] },

  // ── Marketing ─────────────────────────────────────────────────────────────
  { deptName: 'Marketing', isGlobal: false, typeName: 'Campaign', subtypes: ['Email Campaign', 'Social Media Post', 'Paid Ads', 'SEO', 'Influencer Outreach'] },
  { deptName: 'Marketing', isGlobal: false, typeName: 'Content', subtypes: ['Blog Post', 'Case Study', 'Newsletter', 'Press Release', 'Brochure'] },
  { deptName: 'Marketing', isGlobal: false, typeName: 'Analytics', subtypes: ['Performance Report', 'A/B Test Analysis', 'Competitor Watch', 'ROI Report'] },
  { deptName: 'Marketing', isGlobal: false, typeName: 'Events', subtypes: ['Webinar Planning', 'Exhibition', 'Product Launch', 'Workshop'] },

  // ── Content Sales ─────────────────────────────────────────────────────────
  { deptName: 'Content Sales', isGlobal: false, typeName: 'Sales', subtypes: ['Lead Follow-up', 'Proposal Preparation', 'Demo/Presentation', 'Negotiation', 'Closure'] },
  { deptName: 'Content Sales', isGlobal: false, typeName: 'Client Management', subtypes: ['Onboarding', 'Check-in Call', 'Renewal', 'Complaint', 'Feedback'] },
  { deptName: 'Content Sales', isGlobal: false, typeName: 'Content Delivery', subtypes: ['Course Handoff', 'Access Setup', 'Material Dispatch', 'Certification'] },

  // ── Corporate Training ────────────────────────────────────────────────────
  { deptName: 'Corporate Training', isGlobal: false, typeName: 'Program Design', subtypes: ['Session Planning', 'Content Outline', 'Material Creation', 'Trainer Brief'] },
  { deptName: 'Corporate Training', isGlobal: false, typeName: 'Delivery', subtypes: ['Session Delivery', 'Recording', 'Attendance', 'Participant Query'] },
  { deptName: 'Corporate Training', isGlobal: false, typeName: 'Assessment', subtypes: ['Quiz Design', 'Evaluation', 'Result Compilation', 'Certification'] },
  { deptName: 'Corporate Training', isGlobal: false, typeName: 'Coordination', subtypes: ['Scheduling', 'Venue Arrangement', 'Participant Communication', 'MIS Report'] },

  // ── Editors Team ──────────────────────────────────────────────────────────
  { deptName: 'Editors Team', isGlobal: false, typeName: 'Editing', subtypes: ['Video Edit', 'Audio Edit', 'Text Edit', 'Proofreading', 'Subtitle'] },
  { deptName: 'Editors Team', isGlobal: false, typeName: 'Quality Review', subtypes: ['First Cut Review', 'Final Review', 'Compliance Check'] },
  { deptName: 'Editors Team', isGlobal: false, typeName: 'Asset Management', subtypes: ['File Naming', 'Archive', 'Version Control', 'Drive Organization'] },
  { deptName: 'Editors Team', isGlobal: false, typeName: 'Publishing', subtypes: ['Platform Upload', 'Caption Writing', 'Thumbnail', 'Distribution'] },

  // ── QC Team ───────────────────────────────────────────────────────────────
  { deptName: 'QC Team', isGlobal: false, typeName: 'Testing', subtypes: ['Manual Testing', 'Regression Testing', 'UAT', 'Exploratory', 'Smoke Test'] },
  { deptName: 'QC Team', isGlobal: false, typeName: 'Bug Management', subtypes: ['Bug Report', 'Bug Verification', 'Retest', 'Closure Confirmation'] },
  { deptName: 'QC Team', isGlobal: false, typeName: 'Review', subtypes: ['Design Review', 'Content Review', 'Process Review', 'Checklist Audit'] },
  { deptName: 'QC Team', isGlobal: false, typeName: 'Documentation', subtypes: ['Test Plan', 'Test Cases', 'QC Report', 'Sign-off Document'] },

  // ── Retail Business ───────────────────────────────────────────────────────
  { deptName: 'Retail Business', isGlobal: false, typeName: 'Sales', subtypes: ['Lead Generation', 'Lead Follow-up', 'Order Processing', 'Upsell', 'Closure'] },
  { deptName: 'Retail Business', isGlobal: false, typeName: 'Operations', subtypes: ['Inventory Check', 'Dispatch', 'Return Processing', 'Vendor Coordination'] },
  { deptName: 'Retail Business', isGlobal: false, typeName: 'Customer', subtypes: ['Issue Resolution', 'Feedback Collection', 'Onboarding', 'Retention'] },
  { deptName: 'Retail Business', isGlobal: false, typeName: 'Reporting', subtypes: ['Daily Sales Report', 'Weekly Review', 'MIS', 'Target vs Actual'] },

  // ── Accounts ──────────────────────────────────────────────────────────────
  { deptName: 'Accounts', isGlobal: false, typeName: 'Finance Operations', subtypes: ['Invoice Creation', 'Payment Processing', 'Reconciliation', 'Ledger Update'] },
  { deptName: 'Accounts', isGlobal: false, typeName: 'Compliance', subtypes: ['GST Filing', 'TDS', 'Statutory Audit', 'Documentation'] },
  { deptName: 'Accounts', isGlobal: false, typeName: 'Reporting', subtypes: ['Monthly P&L', 'Cash Flow Statement', 'MIS Report', 'Budget Review'] },
  { deptName: 'Accounts', isGlobal: false, typeName: 'Vendor Management', subtypes: ['Vendor Payment', 'PO Processing', 'Expense Approval', 'Vendor Query'] },

  // ── Company / Operations ──────────────────────────────────────────────────
  { deptName: 'Company / Operations', isGlobal: false, typeName: 'Operations', subtypes: ['Process Review', 'SOP Creation', 'Escalation Handling', 'Coordination'] },
  { deptName: 'Company / Operations', isGlobal: false, typeName: 'Administration', subtypes: ['Meeting Scheduling', 'Announcement', 'Policy Update', 'Documentation'] },
  { deptName: 'Company / Operations', isGlobal: false, typeName: 'Facility', subtypes: ['Maintenance Request', 'Procurement', 'Vendor Management', 'Inspection'] },
  { deptName: 'Company / Operations', isGlobal: false, typeName: 'Strategy', subtypes: ['KPI Review', 'Department Alignment', 'Planning Session', 'Report Preparation'] },

  // ── HR ────────────────────────────────────────────────────────────────────
  { deptName: 'HR', isGlobal: false, typeName: 'Recruitment', subtypes: ['Job Posting', 'CV Screening', 'Interview Scheduling', 'Offer Letter', 'Onboarding'] },
  { deptName: 'HR', isGlobal: false, typeName: 'Employee Relations', subtypes: ['Policy Communication', 'Grievance Handling', 'Exit Process', 'Disciplinary'] },
  { deptName: 'HR', isGlobal: false, typeName: 'Compliance', subtypes: ['Document Collection', 'Statutory Filing', 'Record Keeping', 'Audit Support'] },
  { deptName: 'HR', isGlobal: false, typeName: 'General HR', subtypes: ['Attendance Tracking', 'ID Card', 'Announcement', 'Employee Query'] },
];

// Alternative department name mappings (for fallback lookup)
const DEPT_ALIASES: Record<string, string[]> = {
  'Company / Operations': ['Company / Operations', 'Operations', 'Company/Operations'],
  'AI and R&D': ['AI and R&D', 'AI & R&D', 'AI and R and D'],
  'AI & Media Production': ['AI & Media Production', 'AI and Media Production'],
};

async function main() {
  console.log('Starting task type seeding...\n');

  // 1. Build department name → id map
  const departments = await prisma.department.findMany({ select: { id: true, name: true } });
  const deptMap = new Map<string, string>();
  for (const d of departments) {
    deptMap.set(d.name.toLowerCase(), d.id);
  }
  console.log(`Found ${departments.length} departments in DB.`);

  // Helper to find dept id, trying aliases
  const findDeptId = (deptName: string): string | null => {
    const direct = deptMap.get(deptName.toLowerCase());
    if (direct) return direct;
    const aliases = DEPT_ALIASES[deptName] ?? [];
    for (const alias of aliases) {
      const found = deptMap.get(alias.toLowerCase());
      if (found) return found;
    }
    return null;
  };

  let globalTypesCount = 0;
  let deptTypesCount = 0;
  let totalSubtypes = 0;

  // 2. Group entries by dept
  const entriesByDept = new Map<string | null, SeedEntry[]>();
  for (const entry of SEED_DATA) {
    const key = entry.deptName;
    if (!entriesByDept.has(key)) entriesByDept.set(key, []);
    entriesByDept.get(key)!.push(entry);
  }

  // 3. Process each dept group
  for (const [deptName, entries] of entriesByDept) {
    let deptId: string | null = null;

    if (deptName !== null) {
      deptId = findDeptId(deptName);
      if (!deptId) {
        console.warn(`  WARNING: Department "${deptName}" not found — skipping ${entries.length} type(s).`);
        continue;
      }
    }

    for (const entry of entries) {
      // Upsert the TaskType
      let taskType: any;
      try {
        taskType = await prisma.taskType.upsert({
          where: deptId !== null
            ? { name_departmentId: { name: entry.typeName, departmentId: deptId } }
            : { name_departmentId: { name: entry.typeName, departmentId: '' } },
          update: {},
          create: {
            name: entry.typeName,
            departmentId: deptId,
            isGlobal: entry.isGlobal,
          },
        });
      } catch (err: any) {
        // Fallback for null departmentId (Prisma may not support null in unique where)
        const existing = await prisma.taskType.findFirst({
          where: { name: entry.typeName, departmentId: deptId },
        });
        if (existing) {
          taskType = existing;
        } else {
          taskType = await prisma.taskType.create({
            data: {
              name: entry.typeName,
              departmentId: deptId,
              isGlobal: entry.isGlobal,
            },
          });
        }
      }

      if (entry.isGlobal) globalTypesCount++;
      else deptTypesCount++;

      // Upsert each subtype
      for (let i = 0; i < entry.subtypes.length; i++) {
        const subtypeName = entry.subtypes[i];
        try {
          await prisma.taskSubtype.upsert({
            where: { name_taskTypeId: { name: subtypeName, taskTypeId: taskType.id } },
            update: {},
            create: { name: subtypeName, taskTypeId: taskType.id, order: i },
          });
          totalSubtypes++;
        } catch (err: any) {
          const existingSub = await prisma.taskSubtype.findFirst({
            where: { name: subtypeName, taskTypeId: taskType.id },
          });
          if (!existingSub) {
            await prisma.taskSubtype.create({
              data: { name: subtypeName, taskTypeId: taskType.id, order: i },
            });
            totalSubtypes++;
          }
        }
      }
    }
  }

  console.log('\nTask types seeded:');
  console.log(`  Global types: ${globalTypesCount}`);
  console.log(`  Department-specific types: ${deptTypesCount}`);
  console.log(`  Total subtypes: ${totalSubtypes}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
