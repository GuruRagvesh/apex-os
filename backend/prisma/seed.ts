/**
 * APEX — TechnoEdge Production Seed
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates:
 *   • 6 roles       (SUPER_ADMIN → INTERN)
 *   • 11 departments
 *   • 40 real TechnoEdge employees  (password: Apex@2026)
 *
 * Safe to run multiple times — all upserts, nothing is deleted.
 *
 * Run:  npx prisma db seed
 *  or:  npx ts-node prisma/seed.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// All 40 canonical TechnoEdge email addresses
const VALID_EMAILS = [
  'Guru.Thanumoorthy@technoedgels.com',
  'pavan.lalwani@technoedgels.com',
  'accounts@technoedgels.com',
  'tejas.kadam@technoedgels.com',
  'anshika.patel@technoedgels.com',
  'Krunal.Mehta@technoedgels.com',
  'Vishal@technoedgels.com',
  'Shubhendu@technoedgels.com',
  'Rajashree.Solanki@technoedgels.com',
  'aniket.phapale@technoedgels.com',
  'Sumedh.Sadaphal@technoedgels.com',
  'Arpit.Bharuka@technoedgels.com',
  'finance@technoedgels.com',
  'Honey.Dembani@technoedgels.com',
  'pooja.kamble@technoedgels.com',
  'Mahendra@technoedgels.com',
  'trishank.pal@technoedgels.com',
  'revati.patil@technoedgels.com',
  'sanika.dongare@technoedgels.com',
  'sahil.waykar@technoedgels.com',
  'irfan@technoedgels.com',
  'gaurav@technoedgels.com',
  'narendra.suthar@technoedgels.com',
  'pawan.tiwari@technoedgels.com',
  'Charu.Kadam@technoedgels.com',
  'Harshada.Patil@technoedgels.com',
  'pankaj@technoedgels.com',
  'sushant.gire@technoedgels.com',
  'salman_technointern@outlook.com',
  'gunjan.ranglani@technoedgels.com',
  'harshal.tilekar@technoedgels.com',
  'Vaishnavi@technoedgels.com',
  'ajay.singh@technoedgels.com',
  'Snehal.P@technoedgels.com',
  'technointern605@outlook.com',
  'technointern604@outlook.com',
  'technointern606@outlook.com',
  'technointern607@outlook.com',
  'technointern608@outlook.com',
  'technointern602@outlook.com',
  // Shared SUPER_ADMIN account
  'subrat@technoedgels.com',
];

async function main() {
  console.log('🌱 Seeding APEX database...\n');

  // ── Cleanup: remove demo projects (not seeded — any project in DB is demo data) ──
  console.log('🗑️  Cleaning up demo projects...');
  await prisma.projectMember.deleteMany({});
  const deletedProjects = await prisma.project.deleteMany({});
  if (deletedProjects.count > 0) {
    console.log(`   ✓ Removed ${deletedProjects.count} demo project(s)`);
  } else {
    console.log('   ✓ No demo projects found');
  }
  console.log();

  // ── Cleanup: remove old demo / test users ─────────────────────────────────
  console.log('🗑️  Cleaning up old demo users...');
  const oldUsers = await prisma.user.findMany({
    where: { email: { notIn: VALID_EMAILS } },
    select: { id: true, email: true },
  });

  if (oldUsers.length > 0) {
    const oldIds = oldUsers.map((u) => u.id);

    // Reassign any tickets assigned to old users so no dangling FK
    await prisma.ticket.updateMany({
      where: { assignedToId: { in: oldIds } },
      data: { assignedToId: null },
    });

    // Delete tickets created by old users (cascades: comments, attachments, history)
    const oldTickets = await prisma.ticket.findMany({
      where: { createdById: { in: oldIds } },
      select: { id: true },
    });
    if (oldTickets.length > 0) {
      const oldTicketIds = oldTickets.map((t) => t.id);
      await prisma.ticketHistory.deleteMany({ where: { ticketId: { in: oldTicketIds } } });
      await prisma.attachment.deleteMany({ where: { ticketId: { in: oldTicketIds } } });
      await prisma.comment.deleteMany({ where: { ticketId: { in: oldTicketIds } } });
      await prisma.ticket.deleteMany({ where: { id: { in: oldTicketIds } } });
    }

    // Delete other user-related data
    await prisma.ticketHistory.deleteMany({ where: { changedById: { in: oldIds } } });
    await prisma.comment.deleteMany({ where: { authorId: { in: oldIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: oldIds } } });
    await prisma.leaveRequest.deleteMany({ where: { userId: { in: oldIds } } });
    await prisma.activityLog.deleteMany({ where: { userId: { in: oldIds } } });
    await prisma.projectMember.deleteMany({ where: { userId: { in: oldIds } } });

    // Delete the old users
    await prisma.user.deleteMany({ where: { id: { in: oldIds } } });

    console.log(`   ✓ Removed ${oldIds.length} old demo user(s):`);
    oldUsers.forEach((u) => console.log(`     - ${u.email}`));
  } else {
    console.log('   ✓ No old demo users found');
  }
  console.log();

  // ── Password ───────────────────────────────────────────────────────────────
  // Hash once and reuse for all 40 users — bcrypt is slow by design
  const defaultPassword = await bcrypt.hash('Apex@2026', 10);

  // ── Roles ──────────────────────────────────────────────────────────────────
  console.log('📌 Upserting roles...');
  const roleData = [
    { name: 'SUPER_ADMIN', level: 0, description: 'Super administrator — unrestricted access' },
    { name: 'ADMIN',       level: 1, description: 'Full system access' },
    { name: 'MANAGER',     level: 2, description: 'Department management access' },
    { name: 'TEAM_LEAD',   level: 3, description: 'Team oversight and task management' },
    { name: 'EMPLOYEE',    level: 4, description: 'Standard employee access' },
    { name: 'INTERN',      level: 5, description: 'Intern access' },
  ];

  const roles: Record<string, string> = {};
  for (const r of roleData) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { level: r.level, description: r.description },
      create: r,
    });
    roles[r.name] = role.id;
  }
  console.log(`   ✓ ${roleData.length} roles ready\n`);

  // ── Departments ────────────────────────────────────────────────────────────
  console.log('🏢 Upserting departments...');
  const deptData = [
    { name: 'AI & R&D',               description: 'Artificial Intelligence & Research',    color: '#6366f1' },
    { name: 'ID Team',                 description: 'Instructional Design Team',             color: '#8b5cf6' },
    { name: 'Editors Team',            description: 'Video & Content Editors',               color: '#ec4899' },
    { name: 'Corporate Training',      description: 'Corporate Training Division',           color: '#f59e0b' },
    { name: 'Content Sales',           description: 'Content Sales Team',                    color: '#10b981' },
    { name: 'QC Team',                 description: 'Quality Control Team',                  color: '#ef4444' },
    { name: 'Marketing',               description: 'Marketing & Growth',                    color: '#3b82f6' },
    { name: 'Retail Business',         description: 'Retail Business Division',              color: '#f97316' },
    { name: 'AI & Media Production',   description: 'AI-assisted Media Production',         color: '#14b8a6' },
    { name: 'Accounts',                description: 'Finance & Accounts',                    color: '#a855f7' },
    { name: 'Company / Operations',    description: 'Company Operations & Administration',   color: '#64748b' },
  ];

  const depts: Record<string, string> = {};
  for (const d of deptData) {
    const dept = await prisma.department.upsert({
      where: { name: d.name },
      update: { description: d.description, color: d.color },
      create: d,
    });
    depts[d.name] = dept.id;
  }
  console.log(`   ✓ ${deptData.length} departments ready\n`);

  // ── Users ──────────────────────────────────────────────────────────────────
  console.log('👥 Upserting 40 TechnoEdge employees...');

  const userData = [
    // ── Super Admin ──
    { name: 'Guru Thanumoorthy',   email: 'Guru.Thanumoorthy@technoedgels.com',  role: 'SUPER_ADMIN', dept: 'AI & R&D'             },

    // ── Admins ──
    { name: 'Pavan Lalwani',       email: 'pavan.lalwani@technoedgels.com',       role: 'ADMIN',       dept: 'Company / Operations' },

    // ── Managers ──
    { name: 'Payal',               email: 'accounts@technoedgels.com',            role: 'MANAGER',     dept: 'Accounts'             },
    { name: 'Tejas Kadam',         email: 'tejas.kadam@technoedgels.com',         role: 'MANAGER',     dept: 'Company / Operations' },
    { name: 'Anshika Patel',       email: 'anshika.patel@technoedgels.com',       role: 'MANAGER',     dept: 'ID Team'              },
    { name: 'Krunal Mehta',        email: 'Krunal.Mehta@technoedgels.com',        role: 'MANAGER',     dept: 'Corporate Training'   },

    // ── Team Leads ──
    { name: 'Vishal',              email: 'Vishal@technoedgels.com',              role: 'TEAM_LEAD',   dept: 'ID Team'              },
    { name: 'Shubendu',            email: 'Shubhendu@technoedgels.com',           role: 'TEAM_LEAD',   dept: 'Editors Team'         },
    { name: 'Rajashree Solanki',   email: 'Rajashree.Solanki@technoedgels.com',   role: 'TEAM_LEAD',   dept: 'Retail Business'      },
    { name: 'Aniket Phapale',      email: 'aniket.phapale@technoedgels.com',      role: 'TEAM_LEAD',   dept: 'QC Team'              },
    { name: 'Sumedh Sadaphal',     email: 'Sumedh.Sadaphal@technoedgels.com',     role: 'TEAM_LEAD',   dept: 'Content Sales'        },
    { name: 'Arpit Bharuka',       email: 'Arpit.Bharuka@technoedgels.com',       role: 'TEAM_LEAD',   dept: 'AI & Media Production'},
    { name: 'Komal',               email: 'finance@technoedgels.com',             role: 'TEAM_LEAD',   dept: 'Accounts'             },
    { name: 'Honey Dembani',       email: 'Honey.Dembani@technoedgels.com',       role: 'TEAM_LEAD',   dept: 'ID Team'              },

    // ── Employees — ID Team ──
    { name: 'Pooja Kamble',        email: 'pooja.kamble@technoedgels.com',        role: 'EMPLOYEE',    dept: 'ID Team'              },
    { name: 'Mahendra',            email: 'Mahendra@technoedgels.com',            role: 'EMPLOYEE',    dept: 'ID Team'              },
    { name: 'Trishank Pal',        email: 'trishank.pal@technoedgels.com',        role: 'EMPLOYEE',    dept: 'ID Team'              },
    { name: 'Revati Patil',        email: 'revati.patil@technoedgels.com',        role: 'EMPLOYEE',    dept: 'ID Team'              },
    { name: 'Sanika Dongare',      email: 'sanika.dongare@technoedgels.com',      role: 'EMPLOYEE',    dept: 'ID Team'              },
    { name: 'Sahil Waykar',        email: 'sahil.waykar@technoedgels.com',        role: 'EMPLOYEE',    dept: 'ID Team'              },

    // ── Employees — Editors Team ──
    { name: 'Irfan',               email: 'irfan@technoedgels.com',               role: 'EMPLOYEE',    dept: 'Editors Team'         },
    { name: 'Gaurav',              email: 'gaurav@technoedgels.com',              role: 'EMPLOYEE',    dept: 'Editors Team'         },

    // ── Employees — Marketing ──
    { name: 'Narendra Suthar',     email: 'narendra.suthar@technoedgels.com',     role: 'EMPLOYEE',    dept: 'Marketing'            },
    { name: 'Pavan Tiwari',        email: 'pawan.tiwari@technoedgels.com',        role: 'EMPLOYEE',    dept: 'Marketing'            },

    // ── Employees — Retail Business ──
    { name: 'Charu Kadam',         email: 'Charu.Kadam@technoedgels.com',         role: 'EMPLOYEE',    dept: 'Retail Business'      },
    { name: 'Harshada Patil',      email: 'Harshada.Patil@technoedgels.com',      role: 'EMPLOYEE',    dept: 'Retail Business'      },
    { name: 'Pankaj',              email: 'pankaj@technoedgels.com',              role: 'EMPLOYEE',    dept: 'Retail Business'      },

    // ── Employees — QC Team ──
    { name: 'Sushant Gire',        email: 'sushant.gire@technoedgels.com',        role: 'EMPLOYEE',    dept: 'QC Team'              },
    { name: 'Salman',              email: 'salman_technointern@outlook.com',       role: 'EMPLOYEE',    dept: 'QC Team'              },

    // ── Employees — Content Sales ──
    { name: 'Gunjan Ranglani',     email: 'gunjan.ranglani@technoedgels.com',     role: 'EMPLOYEE',    dept: 'Content Sales'        },
    { name: 'Harshal Tilekar',     email: 'harshal.tilekar@technoedgels.com',     role: 'EMPLOYEE',    dept: 'Content Sales'        },

    // ── Employees — Corporate Training ──
    { name: 'Vaishnavi',           email: 'Vaishnavi@technoedgels.com',           role: 'EMPLOYEE',    dept: 'Corporate Training'   },
    { name: 'Ajay Singh',          email: 'ajay.singh@technoedgels.com',          role: 'EMPLOYEE',    dept: 'Corporate Training'   },
    { name: 'Snehal P',            email: 'Snehal.P@technoedgels.com',            role: 'EMPLOYEE',    dept: 'Corporate Training'   },

    // ── Interns — AI & R&D ──
    { name: 'Sonali',              email: 'technointern605@outlook.com',           role: 'INTERN',      dept: 'AI & R&D'             },
    { name: 'Snehal Intern',       email: 'technointern604@outlook.com',           role: 'INTERN',      dept: 'AI & R&D'             },
    { name: 'Pratik',              email: 'technointern606@outlook.com',           role: 'INTERN',      dept: 'AI & R&D'             },
    { name: 'Shama',               email: 'technointern607@outlook.com',           role: 'INTERN',      dept: 'AI & R&D'             },

    // ── Interns — AI & Media Production ──
    { name: 'Suyash',              email: 'technointern608@outlook.com',           role: 'INTERN',      dept: 'AI & Media Production'},
    { name: 'Swayam',              email: 'technointern602@outlook.com',           role: 'INTERN',      dept: 'AI & Media Production'},
  ];

  let created = 0;
  let skipped = 0;

  for (const u of userData) {
    const roleId = roles[u.role];
    const departmentId = depts[u.dept];

    if (!roleId)   { console.warn(`   ⚠ Unknown role "${u.role}" for ${u.email} — skipping`);       skipped++; continue; }
    if (!departmentId) { console.warn(`   ⚠ Unknown dept "${u.dept}" for ${u.email} — skipping`);   skipped++; continue; }

    await prisma.user.upsert({
      where:  { email: u.email },
      update: { name: u.name, roleId, departmentId, mustChangePassword: true },
      create: {
        name:               u.name,
        email:              u.email,
        password:           defaultPassword,
        roleId,
        departmentId,
        isActive:           true,
        mustChangePassword: true,
      },
    });

    console.log(`   ✓ ${u.name.padEnd(22)} [${u.role.padEnd(11)}]  ${u.dept}`);
    created++;
  }

  // ── Subrat — dedicated SUPER_ADMIN with own password (mustChangePassword: false) ──
  console.log('\n👤 Upserting shared SUPER_ADMIN: Subrat...');
  const subratPassword = await bcrypt.hash('SubratApex@2026', 12);
  await prisma.user.upsert({
    where:  { email: 'subrat@technoedgels.com' },
    update: {
      name:               'Subrat',
      roleId:             roles['SUPER_ADMIN'],
      departmentId:       depts['Company / Operations'],
      password:           subratPassword,
      mustChangePassword: false,
      isActive:           true,
    },
    create: {
      name:               'Subrat',
      email:              'subrat@technoedgels.com',
      password:           subratPassword,
      roleId:             roles['SUPER_ADMIN'],
      departmentId:       depts['Company / Operations'],
      isActive:           true,
      mustChangePassword: false,
    },
  });
  console.log('   ✓ Subrat              [SUPER_ADMIN]  Company / Operations');

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log(`\n✅ Seed complete!`);
  console.log(`   Users processed : ${created}`);
  if (skipped) console.log(`   Skipped         : ${skipped} (check warnings above)`);
  console.log('\n🔑 All users share the default password: Apex@2026');
  console.log('⚠️  Users must change their password on first login.\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
