import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../../prisma/prisma.service';

const SHEETS = {
  MASTER: ['ASSET MASTER SHEET', 'ASSET MASTER'],
  ALLOCATION: ['ASSET ALLOCATION SHEET', 'ASSET ALLOCATION'],
  LAPTOPS: ['NEW LAPTOP LIST'],
  RENT: ['RENT SHEET'],
  RECHARGE: ['RECHARGE SHEET'],
  TYPES: ['LIST OF ASSETS'],
  REPAIRS: ['REPAIR LAPTOP LIST'],
} as const;

const HEADERS: Record<keyof typeof SHEETS, string[]> = {
  MASTER: ['Asset ID', 'Asset Type', 'Brand/Model', 'Specification', 'Model Number', 'Owned/Rent', 'Vendor Name', 'Purchase/Issue Date', 'Date of Return', 'Purchase Cost', 'Monthly Rent', 'Current Status', 'Current Employee'],
  ALLOCATION: ['From Date', 'To Date', 'Asset ID', 'Employee Name', 'Branch', 'Returned?', 'Vendor Name', 'Condition', 'Repairing Cost', 'Repairing Date', 'HOD/Manager'],
  LAPTOPS: ['Asset ID', 'Asset Type', 'Brand/Model', 'Specification', 'Model Number', 'Owned/Rent', 'Vendor Name', 'Purchase/Issue Date', 'Date of Return', 'Purchase Cost', 'Monthly Rent', 'Current Status', 'Current Employee', 'Charger'],
  RENT: ['Date', 'Month', 'Asset ID', 'Vendor', 'Employee Name', 'Specification', 'Model Name', 'Monthly Rent', 'Branch', 'Approved by', 'Paid?'],
  RECHARGE: ['Employee Name', 'Branch', 'Model', 'SIM', 'Number', 'Month', 'Last Recharge Date', 'Due Date', 'Plan', 'Amount'],
  TYPES: ['Asset Type'],
  REPAIRS: ['Company', 'Specification', 'Issues'],
};

type SheetKey = keyof typeof SHEETS;

const HEADER_ALIASES: Partial<Record<SheetKey, Record<string, string[]>>> = {
  MASTER: {
    'Asset ID': ['Asset Code', 'Asset No', 'Asset Number'],
    'Asset Type': ['Type', 'Category', 'Asset Category'],
    'Brand/Model': ['Brand', 'Make/Model', 'Brand Model'],
    'Specification': ['Specifications', 'Specs', 'Configuration'],
    'Model Number': ['Model No', 'Serial Number', 'Serial No'],
    'Owned/Rent': ['Owned/Rented', 'Ownership', 'Asset Ownership', 'Owned or Rented'],
    'Vendor Name': ['Vendor', 'Supplier', 'Supplier Name'],
    'Purchase/Issue Date': ['Purchase Date', 'Issue Date', 'Purchase Issue Date'],
    'Date of Return': ['Return Date', 'Vendor Return Date'],
    'Purchase Cost': ['Cost', 'Purchase Price'],
    'Monthly Rent': ['Rent', 'Monthly Rental'],
    'Current Status': ['Status', 'Asset Status'],
    'Current Employee': ['Assigned To', 'Employee', 'Employee Name', 'Current User'],
  },
  LAPTOPS: {
    'Asset ID': ['Asset Code', 'Asset No', 'Asset Number'],
    'Asset Type': ['Type', 'Category', 'Asset Category'],
    'Brand/Model': ['Brand', 'Make/Model', 'Brand Model'],
    'Specification': ['Specifications', 'Specs', 'Configuration'],
    'Model Number': ['Model No', 'Serial Number', 'Serial No'],
    'Owned/Rent': ['Owned/Rented', 'Ownership', 'Asset Ownership', 'Owned or Rented'],
    'Vendor Name': ['Vendor', 'Supplier', 'Supplier Name'],
    'Purchase/Issue Date': ['Purchase Date', 'Issue Date', 'Purchase Issue Date'],
    'Date of Return': ['Return Date', 'Vendor Return Date'],
    'Purchase Cost': ['Cost', 'Purchase Price'],
    'Monthly Rent': ['Rent', 'Monthly Rental'],
    'Current Status': ['Status', 'Asset Status'],
    'Current Employee': ['Assigned To', 'Employee', 'Employee Name', 'Current User'],
    'Charger': ['Charger Included', 'Charger Available'],
  },
  ALLOCATION: {
    'From Date': ['Issue Date', 'Assigned Date', 'Allocation Date'],
    'To Date': ['Employee Return Date', 'Returned Date'],
    'Asset ID': ['Asset Code', 'Asset No', 'Asset Number'],
    'Employee Name': ['Employees Name', 'Employee', 'Assigned To'],
    'Branch': ['Department', 'Location'],
    'Returned?': ['Returned', 'Is Returned', 'Return Status'],
    'Vendor Name': ['Vendor', 'Supplier'],
    'Condition': ['Asset Condition', 'Condition at Issue'],
    'Repairing Cost': ['Repair Cost', 'Repair Amount'],
    'Repairing Date': ['Repair Date'],
    'HOD/Manager': ['HOD', 'Manager', 'Reporting Manager'],
  },
  RENT: {
    'Date': ['Payment Date', 'Entry Date'],
    'Month': ['Rental Month', 'Billing Month'],
    'Asset ID': ['Asset Code', 'Asset No', 'Asset Number'],
    'Vendor': ['Vendor Name', 'Supplier'],
    'Employee Name': ['Employees Name', 'Employee', 'Assigned To'],
    'Specification': ['Specifications', 'Specs', 'Configuration'],
    'Model Name': ['Model', 'Brand/Model', 'Brand Model'],
    'Monthly Rent': ['Rent', 'Monthly Rental', 'Rental Amount'],
    'Branch': ['Department', 'Location'],
    'Approved by': ['Approved By', 'Approver'],
    'Paid?': ['Paid', 'Payment Status'],
  },
  RECHARGE: {
    'Employee Name': ['Employees Name', 'Employee', 'Assigned To'],
    'Branch': ['Department', 'Location'],
    'Model': ['Phone Model', 'Mobile Model', 'Device'],
    'SIM': ['SIM Provider', 'Network', 'Operator'],
    'Number': ['Phone Number', 'Mobile Number', 'SIM Number', 'Assigned Number'],
    'Month': ['Recharge Month', 'Billing Month'],
    'Last Recharge Date': ['Recharge Date', 'Last Recharged'],
    'Due Date': ['Next Due Date', 'Expiry Date'],
    'Plan': ['Recharge Plan'],
    'Amount': ['Recharge Amount', 'Cost'],
  },
  TYPES: { 'Asset Type': ['Type', 'Asset Category', 'Category', 'List of Assets'] },
  REPAIRS: {
    'Company': ['Brand', 'Laptop Brand', 'Make'],
    'Specification': ['Specifications', 'Specs', 'Configuration'],
    'Issues': ['Issue', 'Problem', 'Fault', 'Repair Issue'],
  },
};

const norm = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/').replace(/[?:]/g, '').toUpperCase();
const text = (v: unknown) => String(v ?? '').trim();
const assetLookupKey = (v: unknown) => text(v).toUpperCase().replace(/\s+/g, '').replace(/-0+(\d+)$/, '-$1');
const yes = (v: unknown) => ['YES', 'Y', 'TRUE', '1', 'PAID', 'RETURNED'].includes(norm(v));
const money = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[₹,$,]/g, '').trim());
  return Number.isFinite(n) ? n : null;
};
const asDate = (v: unknown): Date | null => {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const raw = text(v);
  const month = raw.match(/^([A-Za-z]{3,9})[- /](\d{2,4})$/);
  if (month) {
    const year = Number(month[2]) < 100 ? 2000 + Number(month[2]) : Number(month[2]);
    const d = new Date(`${month[1]} 1, ${year} UTC`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};
const monthStart = (v: unknown, fallback?: unknown) => {
  const d = asDate(v) ?? asDate(fallback);
  return d ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)) : null;
};

type ParsedSheet = { key: keyof typeof SHEETS; name: string; rows: Array<Record<string, unknown> & { __row: number }> };

const safeCellValue = (cell: ExcelJS.Cell): unknown => {
  try {
    const value: any = cell.value;
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value.richText)) return value.richText.map((part: any) => part?.text ?? '').join('');
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return value.result ?? '';
    if (Object.prototype.hasOwnProperty.call(value, 'text')) return value.text ?? '';
    return '';
  } catch {
    // Some real-world workbooks contain orphaned merge references. ExcelJS's
    // Cell.text getter throws for those cells, so imports must never depend on it.
    return '';
  }
};

@Injectable()
export class AssetWorkbookService {
  constructor(private readonly prisma: PrismaService) {}

  template(): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Apex OS';
    for (const key of Object.keys(SHEETS) as Array<keyof typeof SHEETS>) {
      const ws = wb.addWorksheet(SHEETS[key][0]);
      ws.addRow(HEADERS[key]);
      const header = ws.getRow(1);
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      HEADERS[key].forEach((h, i) => ws.getColumn(i + 1).width = Math.max(16, h.length + 3));
    }
    return wb;
  }

  private aliases(key: SheetKey) {
    const aliases = new Map<string, string>();
    for (const header of HEADERS[key]) {
      aliases.set(norm(header), header);
      for (const alias of HEADER_ALIASES[key]?.[header] ?? []) aliases.set(norm(alias), header);
    }
    return aliases;
  }

  private columnsForRow(ws: ExcelJS.Worksheet, rowNo: number, key: SheetKey) {
    const aliases = this.aliases(key);
    const found = new Map<number, string>();
    const row = ws.getRow(rowNo);
    for (let col = 1; col <= Math.min(Math.max(ws.columnCount, 1), 80); col++) {
      const header = aliases.get(norm(safeCellValue(row.getCell(col))));
      if (header) found.set(col, header);
    }
    return found;
  }

  private bestHeader(ws: ExcelJS.Worksheet, key: SheetKey) {
    let headerRow = 0;
    let columns = new Map<number, string>();
    for (let rowNo = 1; rowNo <= Math.min(ws.rowCount, 60); rowNo++) {
      const found = this.columnsForRow(ws, rowNo, key);
      if (found.size > columns.size) { headerRow = rowNo; columns = found; }
    }
    return { headerRow, columns };
  }

  private inferSheetKey(ws: ExcelJS.Worksheet): SheetKey | null {
    const named = (Object.keys(SHEETS) as SheetKey[]).find(key => SHEETS[key].some(name => norm(ws.name) === norm(name)));
    if (named) return named;
    const ranked = (Object.keys(SHEETS) as SheetKey[])
      .map(key => ({ key, score: this.bestHeader(ws, key).columns.size }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const minimum = best?.key === 'TYPES' ? 1 : best?.key === 'REPAIRS' ? 2 : 3;
    if (!best || best.score < minimum || (ranked[1]?.score === best.score && best.score < 5)) return null;
    return best.key;
  }

  private parseSheet(ws: ExcelJS.Worksheet, key: SheetKey): ParsedSheet {
    let { headerRow, columns } = this.bestHeader(ws, key);
    const minimum = key === 'TYPES' ? 1 : key === 'REPAIRS' ? 2 : 3;
    if (columns.size < minimum) headerRow = 0;
    // The source workbook's "List of Assets" sheet may be a plain one-column
    // list beside unrelated reports. Read only its first contiguous column.
    if (!headerRow && key === 'TYPES') {
      const rows: ParsedSheet['rows'] = [];
      let started = false;
      for (let rowNo = 1; rowNo <= ws.rowCount; rowNo++) {
        const value = text(safeCellValue(ws.getRow(rowNo).getCell(1)));
        if (!value && started) break;
        if (value && !['LIST OF ASSETS', 'ASSET TYPES', 'ASSET TYPE'].includes(norm(value))) {
          started = true;
          rows.push({ __row: rowNo, 'Asset Type': value });
        }
      }
      return { key, name: ws.name, rows };
    }
    if (!headerRow) throw new BadRequestException(`${ws.name}: header row was not recognized.`);
    const rows: ParsedSheet['rows'] = [];
    for (let rowNo = headerRow + 1; rowNo <= ws.rowCount; rowNo++) {
      const repeatedHeader = this.columnsForRow(ws, rowNo, key);
      if (repeatedHeader.size >= minimum) { columns = repeatedHeader; continue; }
      const result: Record<string, unknown> & { __row: number } = { __row: rowNo };
      const populatedValues: string[] = [];
      for (const [col, header] of columns) {
        const value = safeCellValue(ws.getRow(rowNo).getCell(col));
        result[header] = value;
        if (text(value)) populatedValues.push(norm(value));
      }
      if (!populatedValues.length) continue;
      // Ignore merged section titles and report totals without suppressing
      // genuinely incomplete data rows (those are returned as validation errors).
      const allSame = new Set(populatedValues).size === 1;
      const anchor = ({ MASTER: 'Asset ID', LAPTOPS: 'Asset ID', ALLOCATION: 'Asset ID', RENT: 'Asset ID', RECHARGE: 'Number', REPAIRS: 'Issues', TYPES: 'Asset Type' } as Record<SheetKey, string>)[key];
      if (!text(result[anchor]) && (populatedValues.length <= 2 || allSame)) continue;
      rows.push(result);
    }
    return { key, name: ws.name, rows };
  }

  private async read(file: Express.Multer.File) {
    if (!file?.originalname?.toLowerCase().endsWith('.xlsx')) throw new BadRequestException('Upload an .xlsx workbook.');
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(file.buffer as any); } catch { throw new BadRequestException('The workbook could not be read. It may be damaged or password-protected.'); }
    const parsed: ParsedSheet[] = [];
    const ignoredSheets: string[] = [];
    for (const ws of wb.worksheets) {
      const key = this.inferSheetKey(ws);
      if (!key) { ignoredSheets.push(ws.name); continue; }
      parsed.push(this.parseSheet(ws, key));
    }
    if (!parsed.length) throw new BadRequestException(`No inventory data table was recognized. Expected columns such as Asset ID, Employee Name, Monthly Rent, SIM/Number, or Issues.`);
    if (parsed.every(sheet => sheet.rows.length === 0)) throw new BadRequestException('The workbook contains recognizable headings but no inventory records. Nothing was imported.');
    return { parsed, ignoredSheets };
  }

  private validate(parsed: ParsedSheet[]) {
    const errors: string[] = [];
    const required: Partial<Record<SheetKey, string[]>> = {
      MASTER: ['Asset ID', 'Brand/Model'], LAPTOPS: ['Asset ID', 'Brand/Model'],
      ALLOCATION: ['Asset ID', 'Employee Name'], RENT: ['Asset ID', 'Monthly Rent'],
      RECHARGE: ['Employee Name', 'SIM', 'Number'], REPAIRS: ['Company', 'Issues'], TYPES: ['Asset Type'],
    };
    for (const sheet of parsed) for (const row of sheet.rows) {
      for (const field of required[sheet.key] ?? []) if (!text(row[field])) errors.push(`${sheet.name} row ${row.__row}: ${field} is required.`);
      if (['MASTER', 'LAPTOPS'].includes(sheet.key) && text(row['Owned/Rent']) && !['OWNED', 'RENTED', 'RENT'].includes(norm(row['Owned/Rent']))) errors.push(`${sheet.name} row ${row.__row}: Owned/Rent must be Owned or Rent.`);
    }
    return errors;
  }

  async analyze(file: Express.Multer.File) {
    const { parsed, ignoredSheets } = await this.read(file);
    const errors = this.validate(parsed);
    return {
      canImport: errors.length === 0,
      sheets: parsed.map(sheet => ({ name: sheet.name, category: SHEETS[sheet.key][0], rows: sheet.rows.length })),
      ignoredSheets,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
    };
  }

  async import(file: Express.Multer.File, user: any) {
    const { parsed, ignoredSheets } = await this.read(file);
    const errors = this.validate(parsed);
    if (errors.length) throw new BadRequestException({ message: 'Nothing was imported. Correct the workbook errors and try again.', errors: errors.slice(0, 200), errorCount: errors.length });

    const summary: Record<string, number> = { assetTypes: 0, assets: 0, allocations: 0, rentals: 0, mobileSubscriptions: 0, recharges: 0, repairs: 0 };
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const existingBatch = await this.prisma.assetImportBatch.findFirst({ where: { fileSha256: sha256 }, orderBy: { createdAt: 'desc' } });
    if (existingBatch) return {
      batchId: existingBatch.id,
      fileName: existingBatch.fileName,
      summary: existingBatch.summary,
      sheets: existingBatch.sheets,
      ignoredSheets,
      alreadyImported: true,
    };
    return this.prisma.$transaction(async tx => {
      const assetByCode = new Map<string, any>();
      const pendingEmployees: Array<{ assetId: string; employeeName: string; fromDate: Date }> = [];
      const loadAsset = async (code: unknown) => {
        const rawCode = text(code);
        const key = assetLookupKey(code);
        if (assetByCode.has(key)) return assetByCode.get(key);
        const asset = await tx.companyAsset.findUnique({ where: { assetCode: rawCode } });
        if (asset) assetByCode.set(key, asset);
        return asset;
      };

      for (const sheet of parsed.filter(s => s.key === 'TYPES')) for (const row of sheet.rows) {
        const name = text(row['Asset Type']);
        await tx.assetType.upsert({ where: { name }, update: { isActive: true }, create: { name } }); summary.assetTypes++;
      }
      for (const sheet of parsed.filter(s => s.key === 'MASTER' || s.key === 'LAPTOPS')) for (const row of sheet.rows) {
        const typeName = text(row['Asset Type']);
        const type = typeName ? await tx.assetType.upsert({ where: { name: typeName }, update: {}, create: { name: typeName } }) : null;
        const ownershipValue = norm(row['Owned/Rent']);
        const ownership = ownershipValue === 'OWNED' ? 'OWNED' : ['RENT', 'RENTED'].includes(ownershipValue) ? 'RENTED' : money(row['Monthly Rent']) !== null ? 'RENTED' : 'OWNED';
        const asset = await tx.companyAsset.upsert({ where: { assetCode: text(row['Asset ID']) }, update: {
          assetTypeId: type?.id, brandModel: text(row['Brand/Model']), specification: text(row['Specification']) || null,
          modelNumber: text(row['Model Number']) || null, ownership, vendorName: text(row['Vendor Name']) || null,
          acquisitionDate: asDate(row['Purchase/Issue Date']), vendorReturnDate: asDate(row['Date of Return']),
          purchaseCost: money(row['Purchase Cost']), monthlyRent: money(row['Monthly Rent']),
          status: norm(row['Current Status']) || 'AVAILABLE', ...(sheet.key === 'LAPTOPS' && { chargerIncluded: yes(row['Charger']) }),
        }, create: {
          assetCode: text(row['Asset ID']), assetTypeId: type?.id, brandModel: text(row['Brand/Model']), specification: text(row['Specification']) || null,
          modelNumber: text(row['Model Number']) || null, ownership, vendorName: text(row['Vendor Name']) || null,
          acquisitionDate: asDate(row['Purchase/Issue Date']), vendorReturnDate: asDate(row['Date of Return']),
          purchaseCost: money(row['Purchase Cost']), monthlyRent: money(row['Monthly Rent']), status: norm(row['Current Status']) || 'AVAILABLE',
          chargerIncluded: sheet.key === 'LAPTOPS' ? yes(row['Charger']) : false,
        } });
        assetByCode.set(assetLookupKey(asset.assetCode), asset); summary.assets++;
        if (text(row['Current Employee'])) pendingEmployees.push({ assetId: asset.id, employeeName: text(row['Current Employee']), fromDate: asDate(row['Purchase/Issue Date']) ?? new Date() });
      }
      for (const sheet of parsed.filter(s => s.key === 'ALLOCATION')) for (const row of sheet.rows) {
        const asset = await loadAsset(row['Asset ID']);
        if (!asset) throw new BadRequestException(`${sheet.name} row ${row.__row}: Asset ID ${text(row['Asset ID'])} does not exist.`);
        let returned = yes(row['Returned?']);
        const fromDate = asDate(row['From Date']) ?? asset.acquisitionDate ?? asDate(row['To Date']) ?? new Date();
        let toDate = asDate(row['To Date']);
        if (!returned) {
          const active = await tx.assetAllocation.findFirst({ where: { assetId: asset.id, returned: false }, orderBy: { fromDate: 'desc' } });
          if (active) {
            if (active.fromDate.getTime() <= fromDate.getTime()) {
              await tx.assetAllocation.update({ where: { id: active.id }, data: { returned: true, toDate: fromDate, workflowStatus: 'CLOSED' } });
            } else {
              returned = true;
              toDate = active.fromDate;
            }
          }
        }
        await tx.assetAllocation.create({ data: {
          asset: { connect: { id: asset.id } }, employeeName: text(row['Employee Name']), branch: text(row['Branch']) || null,
          fromDate, toDate, returned,
          conditionAtIssue: text(row['Condition']) || null, repairingCost: money(row['Repairing Cost']), repairingDate: asDate(row['Repairing Date']),
          hodManagerName: text(row['HOD/Manager']) || null, workflowStatus: returned ? 'CLOSED' : 'ACTIVE_ASSIGNMENT',
        } });
        await tx.companyAsset.update({ where: { id: asset.id }, data: { status: returned ? 'AVAILABLE' : 'ALLOCATED' } }); summary.allocations++;
      }
      for (const pending of pendingEmployees) {
        const active = await tx.assetAllocation.findFirst({ where: { assetId: pending.assetId, returned: false } });
        if (!active) { await tx.assetAllocation.create({ data: { asset: { connect: { id: pending.assetId } }, employeeName: pending.employeeName, fromDate: pending.fromDate, returned: false, workflowStatus: 'ACTIVE_ASSIGNMENT' } }); await tx.companyAsset.update({ where: { id: pending.assetId }, data: { status: 'ALLOCATED' } }); summary.allocations++; }
      }
      for (const sheet of parsed.filter(s => s.key === 'RENT')) for (const row of sheet.rows) {
        const asset = await loadAsset(row['Asset ID']);
        if (!asset) throw new BadRequestException(`${sheet.name} row ${row.__row}: Asset ID ${text(row['Asset ID'])} does not exist.`);
        const periodMonth = monthStart(row['Month'], row['Date']);
        if (!periodMonth) throw new BadRequestException(`${sheet.name} row ${row.__row}: Month or Date is invalid.`);
        await tx.assetRentalPayment.upsert({ where: { assetId_periodMonth: { assetId: asset.id, periodMonth } }, update: {
          employeeName: text(row['Employee Name']) || null, branch: text(row['Branch']) || null, vendorName: text(row['Vendor']) || null,
          specification: text(row['Specification']) || null, modelName: text(row['Model Name']) || null, monthlyRent: money(row['Monthly Rent'])!,
          approvedBy: text(row['Approved by']) || null, paid: yes(row['Paid?']),
        }, create: {
          asset: { connect: { id: asset.id } }, periodMonth, employeeName: text(row['Employee Name']) || null, branch: text(row['Branch']) || null,
          vendorName: text(row['Vendor']) || null, specification: text(row['Specification']) || null, modelName: text(row['Model Name']) || null,
          monthlyRent: money(row['Monthly Rent'])!, approvedBy: text(row['Approved by']) || null, paid: yes(row['Paid?']),
        } }); summary.rentals++;
      }
      for (const sheet of parsed.filter(s => s.key === 'RECHARGE')) for (const row of sheet.rows) {
        const phoneNumber = text(row['Number']);
        const subscription = await tx.assetMobileSubscription.upsert({ where: { phoneNumber }, update: {
          employeeName: text(row['Employee Name']), branch: text(row['Branch']) || null, model: text(row['Model']) || null,
          simProvider: text(row['SIM']), plan: text(row['Plan']) || null, amount: money(row['Amount']),
          lastRechargeDate: asDate(row['Last Recharge Date']), dueDate: asDate(row['Due Date']),
        }, create: {
          employeeName: text(row['Employee Name']), branch: text(row['Branch']) || null, model: text(row['Model']) || null,
          simProvider: text(row['SIM']), phoneNumber, plan: text(row['Plan']) || null, amount: money(row['Amount']),
          lastRechargeDate: asDate(row['Last Recharge Date']), dueDate: asDate(row['Due Date']),
        } }); summary.mobileSubscriptions++;
        const billingMonth = monthStart(row['Month'], row['Last Recharge Date']);
        const rechargeAmount = money(row['Amount']);
        if (billingMonth && rechargeAmount !== null) { await tx.assetMobileRecharge.upsert({ where: { subscriptionId_billingMonth: { subscriptionId: subscription.id, billingMonth } }, update: {
          rechargeDate: asDate(row['Last Recharge Date']), dueDate: asDate(row['Due Date']), plan: text(row['Plan']) || null, amount: rechargeAmount,
        }, create: { subscription: { connect: { id: subscription.id } }, billingMonth, rechargeDate: asDate(row['Last Recharge Date']), dueDate: asDate(row['Due Date']), plan: text(row['Plan']) || null, amount: rechargeAmount } }); summary.recharges++; }
      }
      for (const sheet of parsed.filter(s => s.key === 'REPAIRS')) for (const row of sheet.rows) {
        const matches = await tx.companyAsset.findMany({ where: { brandModel: { contains: text(row['Company']), mode: 'insensitive' }, ...(text(row['Specification']) && { specification: { contains: text(row['Specification']), mode: 'insensitive' } }) }, take: 2 });
        await tx.assetRepair.create({ data: { ...(matches.length === 1 && { asset: { connect: { id: matches[0].id } } }), brand: text(row['Company']), specification: text(row['Specification']) || null, issues: text(row['Issues']) } }); summary.repairs++;
      }
      const batch = await tx.assetImportBatch.create({ data: { fileName: file.originalname, fileSha256: sha256, sheets: parsed.map(s => ({ name: s.name, rows: s.rows.length })), summary, importedById: user.id, importedByName: user.name } });
      await tx.assetAuditEvent.create({ data: { actorId: user.id, actorName: user.name, entityType: 'IMPORT_BATCH', entityId: batch.id, action: 'WORKBOOK_IMPORTED', metadata: { fileName: file.originalname, summary } } });
      return { batchId: batch.id, fileName: file.originalname, summary, sheets: parsed.map(s => ({ name: s.name, category: SHEETS[s.key][0], rows: s.rows.length })), ignoredSheets };
    }, { timeout: 120000 });
  }
}
