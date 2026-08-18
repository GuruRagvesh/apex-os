"use client";

import { useState, useMemo, Suspense, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Lead, Role, LeadStage, ColumnConfig, MOCK_LEADS, MOCK_USERS, logAction, useAuth, mapApexRoleToCrmRole, isSalesLeadsBackendEnabled, canDeleteRecord } from "@apex/sales-crm-shared";
import { salesCrmLeadsApi } from "@apex/sales-crm-shared/api";
import { getLeadsStats, filterAndSearchLeads, LeadFilterState, LeadSortState } from "../api/lead-calculations";
import { mapBackendLead, buildCreatePayload } from "../api/lead-adapter";
import { usersApi } from "@apex/core-users/api";
import LeadCreate from "../components/LeadCreate";
import LeadStats from "../components/LeadStats";
import LeadFilters from "../components/LeadFilters";
import LeadList from "../components/LeadList";
import LeadDetail from "../components/LeadDetail";
import ColumnManager from "../components/ColumnManager";
import { Settings2 } from "lucide-react";
import styles from "../styles/leads.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

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

  const backendEnabled = isSalesLeadsBackendEnabled();
  const qc = useQueryClient();

  const leadsQuery = useQuery({
    queryKey: ["sales-crm-leads"],
    queryFn: () => salesCrmLeadsApi.getAll(),
    enabled: backendEnabled,
  });
  const usersQuery = useQuery({
    queryKey: ["sales-crm-assignable-users"],
    queryFn: () => usersApi.getAll(),
    enabled: backendEnabled,
  });

  const [leads, setLeads] = useState<Lead[]>(MOCK_LEADS);
  const [createError, setCreateError] = useState("");

  // effectiveLeads/assignableUsers are the single switch point between mock
  // and backend data — everything below reads from these, never from `leads`
  // or MOCK_USERS directly, so the rest of this component (and its children)
  // don't need to know which mode is active.
  const backendLeadsData: any[] = Array.isArray(leadsQuery.data) ? leadsQuery.data : [];
  const effectiveLeads = useMemo(
    () => (backendEnabled ? backendLeadsData.map(mapBackendLead) : leads),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backendEnabled, leadsQuery.data, leads]
  );
  const assignableUsers = useMemo(() => {
    if (!backendEnabled) return MOCK_USERS;
    const realUsers: any[] = Array.isArray(usersQuery.data) ? usersQuery.data : [];
    return realUsers.map((u) => ({ id: u.id, name: u.name, email: u.email, role: mapApexRoleToCrmRole(u.role?.name) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendEnabled, usersQuery.data]);

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

  const handleSaveNewLead = async (newLead: Lead) => {
    setCreateError("");
    if (backendEnabled) {
      try {
        await salesCrmLeadsApi.create(buildCreatePayload(newLead));
        qc.invalidateQueries({ queryKey: ["sales-crm-leads"] });
      } catch (err: any) {
        setCreateError(err?.message || "Failed to create lead. Please try again.");
        return;
      }
    } else {
      setLeads([newLead, ...leads]);
    }
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
    // In backend mode, callers have already made their own real API call
    // (see LeadInfoPanel/LeadTabs/FollowupTab/RequirementTab) before invoking
    // this — the updatedLead argument itself is only a "something changed,
    // refresh" signal here, not the source of truth.
    if (backendEnabled) {
      qc.invalidateQueries({ queryKey: ["sales-crm-leads"] });
      return;
    }
    setLeads((prev) => prev.map((l) => (l.id === updatedLead.id ? updatedLead : l)));
  };

  const userRole = (user?.role as Role | undefined) ?? Role.EMPLOYEE;
  const canDelete = canDeleteRecord(userRole);
  const canBulkManage = userRole === Role.SUPERADMIN || userRole === Role.ADMIN || userRole === Role.MANAGER;

  const handleDeleteLead = async (leadId: string) => {
    if (!canDelete) {
      setBulkNotice({ message: "You do not have permission to delete leads.", type: "error" });
      setTimeout(() => setBulkNotice(null), 3000);
      return;
    }
    if (backendEnabled) {
      try {
        await salesCrmLeadsApi.remove(leadId);
        qc.invalidateQueries({ queryKey: ["sales-crm-leads"] });
      } catch (err: any) {
        setBulkNotice({ message: err?.message || "Failed to delete lead.", type: "error" });
        setTimeout(() => setBulkNotice(null), 3000);
        return;
      }
    } else {
      setLeads((prev) => prev.filter((l) => l.id !== leadId));
    }
    handleBackToList();
  };

  const filteredLeads = filterAndSearchLeads(effectiveLeads, querySearch, filters, sortState);

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

  const handleBulkAssign = async (newOwner: string) => {
    if (userRole !== Role.SUPERADMIN && userRole !== Role.ADMIN && userRole !== Role.MANAGER) {
      setBulkNotice({ message: "Access Denied: Only Admins/Managers can bulk assign.", type: "error" });
      setTimeout(() => setBulkNotice(null), 3000);
      return;
    }
    if (backendEnabled) {
      try {
        await salesCrmLeadsApi.bulkUpdate({ leadIds: selectedIds, ownerId: newOwner });
        qc.invalidateQueries({ queryKey: ["sales-crm-leads"] });
      } catch (err: any) {
        setBulkNotice({ message: err?.message || "Failed to bulk assign leads.", type: "error" });
        setTimeout(() => setBulkNotice(null), 3000);
        return;
      }
    } else {
      setLeads((prev) =>
        prev.map((l) => {
          if (selectedIds.includes(l.id)) {
            return { ...l, leadOwner: newOwner };
          }
          return l;
        })
      );
    }
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

  const handleBulkStatusChange = async (newStage: LeadStage) => {
    if (userRole !== Role.SUPERADMIN && userRole !== Role.ADMIN && userRole !== Role.MANAGER) {
      setBulkNotice({ message: "Access Denied: Only Admins/Managers can bulk update status.", type: "error" });
      setTimeout(() => setBulkNotice(null), 3000);
      return;
    }
    if (backendEnabled) {
      try {
        await salesCrmLeadsApi.bulkUpdate({ leadIds: selectedIds, leadStage: newStage });
        qc.invalidateQueries({ queryKey: ["sales-crm-leads"] });
      } catch (err: any) {
        setBulkNotice({ message: err?.message || "Failed to bulk update status.", type: "error" });
        setTimeout(() => setBulkNotice(null), 3000);
        return;
      }
    } else {
      setLeads((prev) =>
        prev.map((l) => {
          if (selectedIds.includes(l.id)) {
            return { ...l, leadStage: newStage };
          }
          return l;
        })
      );
    }
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

  const selectedLead = effectiveLeads.find((l) => l.id === queryLeadId);
  const stats = getLeadsStats(effectiveLeads);
  const leadsLoading = backendEnabled && leadsQuery.isLoading;

  return (
    <div className={`${styles["lead-page-container"]} ${selectedLead ? styles["lead-page-container--detail"] : ""}`}>
      {isAddLeadMode ? (
        <>
          {createError && (
            <div className={`${ui["ui-card"]} ui-p-3 ui-badge-error ${styles["lead-mb-4"]} ${styles["lead-br-md"]}`}>
              {createError}
            </div>
          )}
          <LeadCreate onCancel={handleCancelAdd} onSave={handleSaveNewLead} existingLeads={effectiveLeads} />
        </>
      ) : selectedLead ? (
        <LeadDetail lead={selectedLead} onBack={handleBackToList} onUpdate={handleUpdateLead} onDelete={handleDeleteLead} assignableUsers={assignableUsers} />
      ) : leadsLoading ? (
        <div className={`${ui["ui-card"]} ui-p-3`}>Loading leads...</div>
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

          <LeadFilters filters={filters} setFilters={setFilters} sortState={sortState} setSortState={setSortState} onClear={handleClearFilters} assignableUsers={assignableUsers} />

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
                  {assignableUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
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
            assignableUsers={assignableUsers}
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
