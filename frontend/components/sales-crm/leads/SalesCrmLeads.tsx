"use client";

import { useState, Suspense, useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Lead, Role, LeadStage, ColumnConfig } from "@/lib/sales-crm/types";
import { MOCK_LEADS } from "@/lib/sales-crm/mock-data";
import { getLeadsStats, filterAndSearchLeads, LeadFilterState, LeadSortState } from "@/lib/sales-crm/lead-calculations";
import { logAction } from "@/lib/sales-crm/audit-log";
import { useAuth } from "@/lib/sales-crm/auth-adapter";
import LeadCreate from "./LeadCreate";
import LeadStats from "./LeadStats";
import LeadFilters from "./LeadFilters";
import LeadList from "./LeadList";
import LeadDetail from "./LeadDetail";
import ColumnManager from "./ColumnManager";
import { canDeleteRecord } from "@/lib/sales-crm/permissions";
import { Settings2 } from "lucide-react";
import styles from "@/styles/sales-crm/leads.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

function LeadsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const querySearch = searchParams.get("search") || "";
  const queryOwner = searchParams.get("owner") || "";
  const queryStage = searchParams.get("stage") || "";
  const querySource = searchParams.get("source") || "";
  const queryAlert = searchParams.get("alert") || "";
  const queryLeadId = searchParams.get("leadId") || "";
  const queryAction = searchParams.get("action") || "";

  const [leads, setLeads] = useState<Lead[]>(MOCK_LEADS);
  const [filters, setFilters] = useState<LeadFilterState>({
    owner: queryOwner,
    stage: queryStage,
    source: querySource,
    alert: queryAlert,
  });
  const [sortState, setSortState] = useState<LeadSortState>({
    field: "createdDate",
    direction: "desc",
  });

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkNotice, setBulkNotice] = useState<{ message: string; type: "error" | "success" } | null>(null);

  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [showColumnManager, setShowColumnManager] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("salescrm_lead_columns");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setTimeout(() => setColumns(parsed), 0);
      } catch (e) {
        console.error(e);
      }
    }
    if (!stored || !JSON.parse(stored).length) {
      const defaultCols: ColumnConfig[] = [
        { id: "leadOwner", label: "Lead Owner", visible: true },
        { id: "company", label: "Company", visible: true },
        { id: "poc", label: "POC", visible: true },
        { id: "contact", label: "Email / Phone", visible: true },
        { id: "stage", label: "Stage", visible: true },
        { id: "score", label: "Score", visible: true },
        { id: "activity", label: "Last Activity", visible: true },
        { id: "action", label: "Action", visible: true },
      ];
      setTimeout(() => setColumns(defaultCols), 0);
      localStorage.setItem("salescrm_lead_columns", JSON.stringify(defaultCols));
    }
  }, []);

  const handleSetColumns = (newCols: ColumnConfig[]) => {
    setColumns(newCols);
    localStorage.setItem("salescrm_lead_columns", JSON.stringify(newCols));
  };

  const isAddLeadMode = queryAction === "add";

  const handleCancelAdd = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("action");
    router.replace(`${pathname}?${params.toString()}`);
  };

  const handleSaveNewLead = (newLead: Lead) => {
    setLeads([newLead, ...leads]);
    logAction({
      userId: user?.id || "system",
      userName: user ? user.name : "System",
      userRole: (user?.role || "SYSTEM") as Role | "SYSTEM",
      action: "create",
      collection: "Leads",
      entityId: newLead.id,
      details: `Added new lead: ${newLead.company}`,
      after: newLead,
      metadata: {
        lead_status: newLead.leadStage,
        pipeline_stage: newLead.leadStage,
        company: newLead.company,
        department: newLead.department,
        poc: newLead.poc,
        leadOwner: newLead.leadOwner,
      },
    });
    handleCancelAdd();
  };

  const handleClearFilters = () => {
    setFilters({ owner: "", stage: "", source: "", alert: "" });
    if (querySearch || queryOwner || queryStage || querySource || queryAlert) {
      router.push(pathname);
    }
  };

  const handleSelectLead = (leadId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("leadId", leadId);
    router.push(`${pathname}?${params.toString()}`);
  };

  const handleBackToList = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("leadId");
    router.push(`${pathname}?${params.toString()}`);
  };

  const handleUpdateLead = (updatedLead: Lead) => {
    setLeads((prev) => prev.map((l) => (l.id === updatedLead.id ? updatedLead : l)));
  };

  const userRole = (user?.role as Role | undefined) ?? Role.EMPLOYEE;
  const canDelete = canDeleteRecord(userRole);
  const canBulkManage = userRole === Role.SUPERADMIN || userRole === Role.ADMIN || userRole === Role.MANAGER;

  const handleDeleteLead = (leadId: string) => {
    if (!canDelete) {
      setBulkNotice({ message: "You do not have permission to delete leads.", type: "error" });
      setTimeout(() => setBulkNotice(null), 3000);
      return;
    }
    setLeads((prev) => prev.filter((l) => l.id !== leadId));
    handleBackToList();
  };

  const filteredLeads = filterAndSearchLeads(leads, querySearch, filters, sortState);

  const handleToggleSelect = (leadId: string) => {
    setSelectedIds((prev) => (prev.includes(leadId) ? prev.filter((id) => id !== leadId) : [...prev, leadId]));
  };

  const handleToggleSelectAll = () => {
    if (selectedIds.length === filteredLeads.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredLeads.map((l) => l.id));
    }
  };

  const handleBulkAssign = (newOwner: string) => {
    if (userRole !== Role.SUPERADMIN && userRole !== Role.ADMIN && userRole !== Role.MANAGER) {
      setBulkNotice({ message: "Access Denied: Only Admins/Managers can bulk assign.", type: "error" });
      setTimeout(() => setBulkNotice(null), 3000);
      return;
    }
    setLeads((prev) =>
      prev.map((l) => {
        if (selectedIds.includes(l.id)) {
          return { ...l, leadOwner: newOwner };
        }
        return l;
      })
    );
    selectedIds.forEach((id) => {
      logAction({
        userId: user?.id || "system",
        userName: user ? user.name : "System",
        userRole: userRole,
        action: "update",
        collection: "Leads",
        entityId: id,
        details: `Bulk reassigned to ${newOwner}`,
      });
    });
    setSelectedIds([]);
    setBulkNotice({ message: `Successfully assigned ${selectedIds.length} leads to ${newOwner}`, type: "success" });
    setTimeout(() => setBulkNotice(null), 3000);
  };

  const handleBulkStatusChange = (newStage: LeadStage) => {
    if (userRole !== Role.SUPERADMIN && userRole !== Role.ADMIN && userRole !== Role.MANAGER) {
      setBulkNotice({ message: "Access Denied: Only Admins/Managers can bulk update status.", type: "error" });
      setTimeout(() => setBulkNotice(null), 3000);
      return;
    }
    setLeads((prev) =>
      prev.map((l) => {
        if (selectedIds.includes(l.id)) {
          return { ...l, leadStage: newStage };
        }
        return l;
      })
    );
    selectedIds.forEach((id) => {
      logAction({
        userId: user?.id || "system",
        userName: user ? user.name : "System",
        userRole: userRole,
        action: "stage_change",
        collection: "Leads",
        entityId: id,
        details: `Bulk status changed to ${newStage}`,
      });
    });
    setSelectedIds([]);
    setBulkNotice({ message: `Successfully updated status to ${newStage} for ${selectedIds.length} leads`, type: "success" });
    setTimeout(() => setBulkNotice(null), 3000);
  };

  const selectedLead = leads.find((l) => l.id === queryLeadId);
  const stats = getLeadsStats(leads);

  return (
    <div className={`${styles["lead-page-container"]} ${selectedLead ? styles["lead-page-container--detail"] : ""}`}>
      {isAddLeadMode ? (
        <LeadCreate onCancel={handleCancelAdd} onSave={handleSaveNewLead} existingLeads={leads} />
      ) : selectedLead ? (
        <LeadDetail lead={selectedLead} onBack={handleBackToList} onUpdate={handleUpdateLead} onDelete={handleDeleteLead} />
      ) : (
        <>
          <div className={styles["lead-list-summary-row"]}>
            <LeadStats stats={stats} />
            <button
              className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]} ${styles["lead-list-columns-button"]}`}
              onClick={() => setShowColumnManager(true)}
              title="Manage Columns"
            >
              <Settings2 size={18} />
              <span className="lead-hide-mobile">Columns</span>
            </button>
          </div>

          <LeadFilters filters={filters} setFilters={setFilters} sortState={sortState} setSortState={setSortState} onClear={handleClearFilters} />

          {bulkNotice && (
            <div className={`${ui["ui-card"]} ui-p-3 ${bulkNotice.type === "error" ? "ui-badge-error" : ui["ui-badge-success"]} ${styles["lead-mb-4"]} ${styles["lead-br-md"]}`}>
              {bulkNotice.message}
            </div>
          )}

          {canBulkManage && selectedIds.length > 0 && (
            <div
              className={`${ui["ui-card"]} ui-p-3 ${styles["lead-mb-4"]} ${styles["lead-flex"]} ${styles["lead-align-center"]} ${styles["lead-justify-between"]} ${styles["lead-bg-hover"]} ${styles["lead-bulk-action-bar"]}`}
            >
              <span className={styles["lead-text-medium"]}>{selectedIds.length} Selected</span>
              <div className={`${styles["lead-flex"]} ${styles["lead-gap-3"]} ${styles["lead-align-center"]}`}>
                <select
                  className={`${ui["ui-select"]} ${styles["lead-bulk-select"]}`}
                  onChange={(e) => {
                    if (e.target.value) handleBulkAssign(e.target.value);
                    e.target.value = "";
                  }}
                >
                  <option value="">Bulk Assign Owner...</option>
                  <option value="u-superadmin-1">Priya</option>
                  <option value="u-admin-1">Rahul</option>
                  <option value="u-employee-1">Sneha</option>
                </select>
                <select
                  className={`${ui["ui-select"]} ${styles["lead-bulk-select"]}`}
                  onChange={(e) => {
                    if (e.target.value) handleBulkStatusChange(e.target.value as LeadStage);
                    e.target.value = "";
                  }}
                >
                  <option value="">Bulk Change Stage...</option>
                  <option value="Created">Created</option>
                  <option value="Cold">Cold</option>
                  <option value="Level 0">Level 0</option>
                  <option value="Level 1">Level 1</option>
                  <option value="Level 2">Level 2</option>
                  <option value="Closed">Closed</option>
                  <option value="Invalid">Invalid</option>
                </select>
              </div>
            </div>
          )}

          <LeadList
            leads={filteredLeads}
            columns={columns}
            onSelectLead={handleSelectLead}
            onUpdateLead={handleUpdateLead}
            userRole={userRole}
            canBulkManage={canBulkManage}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
            onQuickAddActivity={(leadId) => {
              const params = new URLSearchParams(searchParams.toString());
              params.set("leadId", leadId);
              params.set("action", "add-activity");
              router.push(`${pathname}?${params.toString()}`);
            }}
          />
          {showColumnManager && <ColumnManager columns={columns} setColumns={handleSetColumns} onClose={() => setShowColumnManager(false)} />}
        </>
      )}
    </div>
  );
}

export default function SalesCrmLeads() {
  return (
    <Suspense fallback={<div className="ui-p-3">Loading...</div>}>
      <LeadsPageContent />
    </Suspense>
  );
}
