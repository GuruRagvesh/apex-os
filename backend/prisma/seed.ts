/**
 * NEXUS — Production Seed
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates the minimum required data for a first deployment:
 *   • 4 roles  (Admin, Manager, Team Lead, Employee)
 *   • 5 departments
 *   • 1 admin superuser  +  representative users per role
 *   • 2 sample projects  +  sample tickets for demo purposes
 *
 * Safe to run multiple times — all upserts, nothing is deleted.
 *
 * Run:  npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
 *  or:  npx prisma db seed
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  PrismaClient,
  TicketCategory,
  TicketType,
  Priority,
  TicketStatus,
  ProjectStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding NEXUS database...');

  // ── Roles ────────────────────────────────────────────────────────────────
  const [adminRole, managerRole, teamLeadRole, employeeRole] = await Promise.all([
    prisma.role.upsert({
      where: { name: 'Admin' },
      update: {},
      create: { name: 'Admin', level: 1, description: 'Full system access' },
    }),
    prisma.role.upsert({
      where: { name: 'Manager' },
      update: {},
      create: { name: 'Manager', level: 2, description: 'Department management access' },
    }),
    prisma.role.upsert({
      where: { name: 'Team Lead' },
      update: {},
      create: { name: 'Team Lead', level: 3, description: 'Team oversight and task management' },
    }),
    prisma.role.upsert({
      where: { name: 'Employee' },
      update: {},
      create: { name: 'Employee', level: 4, description: 'Standard employee access' },
    }),
  ]);

  // ── Departments ───────────────────────────────────────────────────────────
  const [itDept, facilitiesDept, hrDept, operationsDept] = await Promise.all([
    prisma.department.upsert({
      where: { name: 'IT' },
      update: {},
      create: { name: 'IT', description: 'Information Technology', color: '#6366f1' },
    }),
    prisma.department.upsert({
      where: { name: 'Facilities' },
      update: {},
      create: { name: 'Facilities', description: 'Building & Maintenance', color: '#f59e0b' },
    }),
    prisma.department.upsert({
      where: { name: 'HR' },
      update: {},
      create: { name: 'HR', description: 'Human Resources', color: '#ec4899' },
    }),
    prisma.department.upsert({
      where: { name: 'Operations' },
      update: {},
      create: { name: 'Operations', description: 'Business Operations', color: '#10b981' },
    }),
    prisma.department.upsert({
      where: { name: 'Finance' },
      update: {},
      create: { name: 'Finance', description: 'Finance & Accounting', color: '#3b82f6' },
    }),
  ]);

  // ── Users ─────────────────────────────────────────────────────────────────
  // NOTE: Change these passwords immediately after first login in production.
  const [adminUser, managerUser, teamLeadUser, employee1, employee2, facilitiesUser] =
    await Promise.all([
      prisma.user.upsert({
        where: { email: 'admin@technoedge.com' },
        update: {},
        create: {
          email: 'admin@technoedge.com',
          name: 'System Admin',
          password: await bcrypt.hash('Admin@123', 10),
          roleId: adminRole.id,
          departmentId: itDept.id,
        },
      }),
      prisma.user.upsert({
        where: { email: 'manager@technoedge.com' },
        update: {},
        create: {
          email: 'manager@technoedge.com',
          name: 'Rajesh Kumar',
          password: await bcrypt.hash('Manager@123', 10),
          roleId: managerRole.id,
          departmentId: itDept.id,
        },
      }),
      prisma.user.upsert({
        where: { email: 'teamlead@technoedge.com' },
        update: {},
        create: {
          email: 'teamlead@technoedge.com',
          name: 'Priya Sharma',
          password: await bcrypt.hash('Lead@123', 10),
          roleId: teamLeadRole.id,
          departmentId: itDept.id,
        },
      }),
      prisma.user.upsert({
        where: { email: 'arjun@technoedge.com' },
        update: {},
        create: {
          email: 'arjun@technoedge.com',
          name: 'Arjun Patel',
          password: await bcrypt.hash('Employee@123', 10),
          roleId: employeeRole.id,
          departmentId: itDept.id,
        },
      }),
      prisma.user.upsert({
        where: { email: 'sneha@technoedge.com' },
        update: {},
        create: {
          email: 'sneha@technoedge.com',
          name: 'Sneha Verma',
          password: await bcrypt.hash('Employee@123', 10),
          roleId: employeeRole.id,
          departmentId: hrDept.id,
        },
      }),
      prisma.user.upsert({
        where: { email: 'ravi@technoedge.com' },
        update: {},
        create: {
          email: 'ravi@technoedge.com',
          name: 'Ravi Singh',
          password: await bcrypt.hash('Employee@123', 10),
          roleId: employeeRole.id,
          departmentId: facilitiesDept.id,
        },
      }),
    ]);

  // ── Projects ──────────────────────────────────────────────────────────────
  const [project1, project2] = await Promise.all([
    prisma.project.upsert({
      where: { projectId: 'PRJ-001' },
      update: {},
      create: {
        projectId: 'PRJ-001',
        name: 'Office Network Upgrade',
        description: 'Upgrade all office network infrastructure to gigabit ethernet',
        status: ProjectStatus.ACTIVE,
        priority: Priority.HIGH,
        departmentId: itDept.id,
        startDate: new Date('2024-01-15'),
        endDate: new Date('2024-03-30'),
      },
    }),
    prisma.project.upsert({
      where: { projectId: 'PRJ-002' },
      update: {},
      create: {
        projectId: 'PRJ-002',
        name: 'Employee Onboarding Revamp',
        description: 'Redesign the employee onboarding process and documentation',
        status: ProjectStatus.ACTIVE,
        priority: Priority.MEDIUM,
        departmentId: hrDept.id,
        startDate: new Date('2024-02-01'),
      },
    }),
  ]);

  // ── Project Members ───────────────────────────────────────────────────────
  await Promise.all([
    prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project1.id, userId: adminUser.id } },
      update: {},
      create: { projectId: project1.id, userId: adminUser.id, role: 'OWNER' },
    }),
    prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project1.id, userId: managerUser.id } },
      update: {},
      create: { projectId: project1.id, userId: managerUser.id, role: 'MEMBER' },
    }),
    prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project1.id, userId: employee1.id } },
      update: {},
      create: { projectId: project1.id, userId: employee1.id, role: 'MEMBER' },
    }),
  ]);

  // ── Sample Tickets ────────────────────────────────────────────────────────
  const ticketData = [
    {
      ticketId: 'TKT-001',
      title: 'Replace conference room projector bulb',
      description: 'The projector in Conference Room A has a blown bulb. Needs replacement before Monday meeting.',
      category: TicketCategory.FACILITIES,
      type: TicketType.MAINTENANCE,
      priority: Priority.HIGH,
      status: TicketStatus.OPEN,
      estimatedTime: 1,
      departmentId: facilitiesDept.id,
      assignedToId: facilitiesUser.id,
      createdById: managerUser.id,
    },
    {
      ticketId: 'TKT-002',
      title: 'Clean washroom - Floor 2',
      description: 'Deep cleaning required for Floor 2 washrooms. Schedule for end of day.',
      category: TicketCategory.FACILITIES,
      type: TicketType.TASK,
      priority: Priority.MEDIUM,
      status: TicketStatus.IN_PROGRESS,
      estimatedTime: 2,
      departmentId: facilitiesDept.id,
      assignedToId: facilitiesUser.id,
      createdById: adminUser.id,
    },
    {
      ticketId: 'TKT-003',
      title: 'Replace light bulb - IT Room 3B',
      description: 'Two ceiling lights in IT Room 3B are not working.',
      category: TicketCategory.FACILITIES,
      type: TicketType.MAINTENANCE,
      priority: Priority.LOW,
      status: TicketStatus.OPEN,
      estimatedTime: 0.5,
      departmentId: facilitiesDept.id,
      createdById: employee1.id,
    },
    {
      ticketId: 'TKT-004',
      title: 'VPN access not working for remote employees',
      description: 'Multiple employees reporting VPN connection failures since morning. Urgent fix needed.',
      category: TicketCategory.IT,
      type: TicketType.INCIDENT,
      priority: Priority.URGENT,
      status: TicketStatus.IN_PROGRESS,
      estimatedTime: 4,
      projectId: project1.id,
      departmentId: itDept.id,
      assignedToId: employee1.id,
      createdById: managerUser.id,
    },
    {
      ticketId: 'TKT-005',
      title: 'Setup new employee laptop',
      description: 'New joinee starting Monday. Need laptop configured with all standard software.',
      category: TicketCategory.IT,
      type: TicketType.REQUEST,
      priority: Priority.HIGH,
      status: TicketStatus.OPEN,
      estimatedTime: 3,
      departmentId: itDept.id,
      assignedToId: teamLeadUser.id,
      createdById: employee2.id,
    },
    {
      ticketId: 'TKT-006',
      title: 'Update employee handbook 2024',
      description: 'Annual update to employee handbook including new WFH policies and leave rules.',
      category: TicketCategory.HR,
      type: TicketType.TASK,
      priority: Priority.MEDIUM,
      status: TicketStatus.REVIEW,
      estimatedTime: 8,
      projectId: project2.id,
      departmentId: hrDept.id,
      assignedToId: employee2.id,
      createdById: managerUser.id,
    },
    {
      ticketId: 'TKT-007',
      title: 'Fix AC unit - Operations floor',
      description: 'AC in operations area making noise and not cooling properly. Technician visit needed.',
      category: TicketCategory.FACILITIES,
      type: TicketType.MAINTENANCE,
      priority: Priority.HIGH,
      status: TicketStatus.OPEN,
      estimatedTime: 3,
      departmentId: facilitiesDept.id,
      createdById: employee1.id,
    },
    {
      ticketId: 'TKT-008',
      title: 'Printer on Floor 1 not working',
      description: 'Canon printer shows paper jam error but no paper visible inside.',
      category: TicketCategory.IT,
      type: TicketType.SUPPORT,
      priority: Priority.MEDIUM,
      status: TicketStatus.DONE,
      estimatedTime: 1,
      actualTime: 1.5,
      departmentId: itDept.id,
      assignedToId: teamLeadUser.id,
      createdById: employee2.id,
      resolvedAt: new Date(),
    },
  ];

  for (const ticket of ticketData) {
    await prisma.ticket.upsert({
      where: { ticketId: ticket.ticketId },
      update: {},
      create: ticket,
    });
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log('\n✅ Seed complete!');
  console.log('\n📋 Default Login Credentials:');
  console.log('  Admin:     admin@technoedge.com      / Admin@123');
  console.log('  Manager:   manager@technoedge.com    / Manager@123');
  console.log('  Team Lead: teamlead@technoedge.com   / Lead@123');
  console.log('  Employee:  arjun@technoedge.com      / Employee@123');
  console.log('\n⚠️  Change all passwords immediately after first login in production!\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
