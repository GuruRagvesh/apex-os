/**
 * What one employee's archive contains, before it becomes a ZIP.
 *
 * An in-memory model first, and the ZIP is a rendering of it. That split is
 * what lets the collector be tested without a filesystem, and the packer be
 * tested without a database.
 */

export interface ArchiveManifest {
  /**
   * Bumped when the SHAPE changes in a way that a reader must notice.
   *
   * Not a compatibility framework -- nothing negotiates on it. It exists so
   * somebody opening a three-year-old archive can tell which layout they are
   * looking at.
   */
  archiveVersion: string;
  generatedAt: string;
  environment: string;
  /** Git revision when the build recorded one. Null rather than invented. */
  applicationVersion: string | null;

  formerUserId: string;
  employeeId: string | null;
  displayName: string;

  archivedByUserId: string | null;
  archivedByDisplayName: string | null;

  /** Dataset keys actually present, in a stable order. */
  datasets: string[];
  /** Rows per dataset. The count a reader checks their import against. */
  entityCounts: Record<string, number>;

  /**
   * Named so a reader can tell "this archive has no passwords in it" from
   * "this archive happens not to have reached that table".
   */
  excludedSecretCategories: string[];

  /** Filled by the packer, once the bytes exist. */
  archiveBytes?: number;
  archiveChecksum?: string;
}

/**
 * The employee's own identity and employment record.
 *
 * POSITIVELY SELECTED, FIELD BY FIELD, and that is deliberate. The alternative
 * -- `const { password, ...rest } = user` -- is one rename away from leaking:
 * a new secret column added next year arrives in `rest` automatically and
 * nothing fails. Here a new column is absent until somebody adds it on
 * purpose.
 */
export interface ArchivedEmployee {
  id: string;
  employeeId: string | null;
  name: string;
  email: string;
  phone: string | null;
  avatar: string | null;
  photoUrl: string | null;

  dateOfBirth: string | null;
  gender: string | null;
  bloodGroup: string | null;
  currentAddress: string | null;
  permanentAddress: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  emergencyRelation: string | null;

  roleName: string | null;
  departmentName: string | null;
  designation: string | null;
  employmentType: string | null;
  workMode: string | null;
  workLocation: string | null;
  userLocation: string | null;
  shiftTiming: string | null;
  joiningDate: string | null;
  lastWorkingDate: string | null;
  probationPeriod: string | null;
  reportingManager: string | null;
  teamLeadName: string | null;
  isHR: boolean;
  isAttendanceDataOperator: boolean;
  isActive: boolean;

  /**
   * Payroll and statutory identifiers.
   *
   * INCLUDED DELIBERATELY, and this was a real decision rather than an
   * oversight. They are sensitive, and the instinct is to strip them -- but
   * the archive REPLACES the database row that is about to be deleted, and
   * Indian payroll compliance requires PAN, UAN and payment records to be
   * retainable for years after someone leaves. Excluding them would mean
   * deletion destroys statutory records the company is obliged to keep.
   *
   * They are not authentication secrets: none of them can be used to sign in
   * as anybody. The protection they need is access control on the Drive
   * folder, which is a deployment concern, not omission from the record.
   */
  ctcAnnual: string | null;
  basicSalary: string | null;
  salaryStructure: string | null;
  bankName: string | null;
  accountNumber: string | null;
  ifscCode: string | null;
  accountHolderName: string | null;
  paymentMode: string | null;
  panNumber: string | null;
  aadhaarNumber: string | null;
  uanNumber: string | null;
  pfApplicable: boolean | null;
  esicApplicable: boolean | null;
  professionalTax: boolean | null;
  taxRegime: string | null;

  verificationStatus: string | null;
  verificationDate: string | null;
  hrNotes: string | null;
  bio: string | null;

  createdAt: string | null;
  updatedAt: string | null;
}

/** One classified relation, and how many rows of it this person had. */
export interface RelationSummaryRow {
  model: string;
  field: string;
  action: string;
  rows: number | null;
  why: string;
}

export interface EmployeeArchive {
  manifest: ArchiveManifest;
  employee: ArchivedEmployee;
  /** Dataset key -> rows. Only datasets that exist and have content. */
  datasets: Record<string, unknown[]>;
  /**
   * What pointed at this person, what the classification says happens to it,
   * and how many rows there were.
   *
   * THE PART THAT MAKES THE ARCHIVE AUDITABLE. Without it a reader can see
   * what was kept but not what was deliberately not kept, and cannot tell a
   * dataset that was empty from one nobody collected.
   */
  relationships: RelationSummaryRow[];
}

/**
 * Secret categories the collector refuses to carry.
 *
 * Listed by CATEGORY rather than by column so the manifest says something
 * meaningful even for categories this schema has no table for -- a reader
 * should be able to tell "there are no refresh tokens in here" from "this
 * system never had any", and the archive should keep saying so if one is
 * added later.
 */
export const EXCLUDED_SECRET_CATEGORIES = [
  'passwordHash',
  'refreshTokens',
  'accessTokens',
  'passwordResetTokens',
  'otpCodesAndSecrets',
  'mfaSecrets',
  'sessionSecrets',
  'apiKeys',
  'providerCredentials',
] as const;

export const ARCHIVE_VERSION = '1.0';
