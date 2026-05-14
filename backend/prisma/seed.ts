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

async function main() {
  console.log('🌱 Seeding APEX database...\n');

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
