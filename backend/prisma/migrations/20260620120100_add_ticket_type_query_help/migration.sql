-- Phase D2.1: add QUERY and HELP work-item types to TicketType.
-- Kept as its own isolated migration, separate from the table/column
-- migration above: PostgreSQL historically restricts adding enum values
-- in the same transaction as other DDL (and from being used in the same
-- transaction they were added in), so isolating this avoids that whole
-- class of failure and lets this step be applied/rolled back independently.

ALTER TYPE "TicketType" ADD VALUE IF NOT EXISTS 'QUERY';
ALTER TYPE "TicketType" ADD VALUE IF NOT EXISTS 'HELP';
