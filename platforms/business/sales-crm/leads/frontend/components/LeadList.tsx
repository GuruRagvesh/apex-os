"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Lead, LeadStage, Role, ColumnConfig, useAuth, isContactFieldVisible, MOCK_USERS, ROLE_LABELS, logAction, isSalesLeadsBackendEnabled } from "@apex/sales-crm-shared";
import { MoreVertical, Mail, Phone, PlusCircle, UserCog } from "lucide-react";
import { salesCrmLeadsApi } from "@/lib/api";
import styles from "../styles/leads.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

interface LeadListProps {
  leads: Lead[];
  columns: ColumnConfig[];
  onSelectLead: (leadId: string) => void;
  onUpdateLead: (lead: Lead) => void;
  userRole: Role;
  canBulkManage: boolean;
  selectedIds: string[];
  onToggleSelect: (leadId: string) => void;
  onToggleSelectAll: () => void;
  onQuickAddActivity: (leadId: string) => void;
  assignableUsers?: { id: string; name: string; role: Role }[];
}

export default function LeadList({
  leads,
  columns,
  onSelectLead,
  onUpdateLead,
  userRole,
  canBulkManage,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onQuickAddActivity,
  assignableUsers,
}: LeadListProps) {
  const { user } = useAuth();
  const currentUserId = user?.id || "";
  const backendEnabled = isSalesLeadsBackendEnabled();
  const ownerDirectory = assignableUsers ?? MOCK_USERS;

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [ownerChangeId, setOwnerChangeId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number; bottom: number; width: number; height: number } | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const ownerRef = useRef<HTMLDivElement>(null);

  const getStageColor = (stage: LeadStage) => {
    switch (stage) {
      case "Created":
      case "Cold":
      case "Level 0":
      case "Level 0(A)":
        return ui["ui-badge-warning"];
      case "Level 1":
      case "Level 1(A)":
      case "Level 2":
      case "Level 3":
        return ui["ui-badge-info"];
      case "Level 4":
      case "Level 4(A)":
      case "Level 5":
      case "Level 6":
        return ui["ui-badge-success"];
      case "Closed":
      case "Invalid":
      case "Hold":
        return "ui-badge-error";
      default:
        return "ui-badge-secondary";
    }
  };

  const isAllSelected = leads.length > 0 && selectedIds.length === leads.length;
  const visibleColumns = columns.filter((c) => c.visible);

  const canActOnLead = (leadOwnerId: string) => {
    if (
      [Role.SUPERADMIN, Role.ADMIN, Role.MANAGER].includes(userRole)
    )
      return true;
    return leadOwnerId === currentUserId;
  };

  const closeAll = useCallback(() => {
    setOpenMenuId(null);
    setOwnerChangeId(null);
    setMenuPos(null);
  }, []);

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ownerChangeId) {
        if (ownerRef.current && !ownerRef.current.contains(t)) {
          closeAll();
        }
      } else if (openMenuId) {
        if (menuRef.current && !menuRef.current.contains(t)) {
          closeAll();
        }
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [closeAll, ownerChangeId, openMenuId]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAll();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [closeAll]);

  // Close on scroll or resize
  useEffect(() => {
    const handler = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current && menuRef.current.contains(t)) return;
      if (ownerRef.current && ownerRef.current.contains(t)) return;
      closeAll();
    };
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", closeAll);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", closeAll);
    };
  }, [closeAll]);

  // Position portal popovers before paint so the menu never flashes in-table.
  useLayoutEffect(() => {
    if (openMenuId && menuPos) {
      const el = ownerChangeId ? ownerRef.current : menuRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const spaceBelow = window.innerHeight - menuPos.bottom;
        const spaceAbove = menuPos.top;

        let topPx = 0;
        if (spaceBelow >= rect.height || spaceBelow > spaceAbove) {
          topPx = menuPos.bottom + 4;
        } else {
          topPx = menuPos.top - rect.height - 4;
        }

        const maxTop = Math.max(4, window.innerHeight - rect.height - 4);
        const boundedTop = Math.min(Math.max(4, topPx), maxTop);
        // Anchor to the right of the trigger button, but don't clip viewport edges.
        const leftPx = Math.max(4, menuPos.right - rect.width);
        const maxLeft = Math.max(4, window.innerWidth - rect.width - 4);
        const boundedLeft = Math.min(leftPx, maxLeft);

        el.style.top = `${boundedTop}px`;
        el.style.left = `${boundedLeft}px`;
        el.style.opacity = "1";
      }
    }
  }, [openMenuId, menuPos, ownerChangeId]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleToggleMenu = (e: React.MouseEvent, leadId: string) => {
    e.stopPropagation();
    if (openMenuId === leadId) {
      closeAll();
      return;
    }
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();

    setMenuPos({
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    });
    setOpenMenuId(leadId);
    setOwnerChangeId(null);

    logAction({
      userId: user?.id || "system",
      userName: user?.name || "System",
      userRole: user?.role || "SYSTEM",
      action: "action_menu_opened",
      collection: "Leads",
      entityId: leadId,
      details: "Opened row action menu",
      metadata: { leadId },
    });
  };

  const handleEmail = (lead: Lead) => {
    const ownerUser = ownerDirectory.find((u) => u.id === lead.leadOwner);
    const subject = encodeURIComponent(
      `SalesCRM follow-up - ${lead.company}`
    );
    const body = encodeURIComponent(
      [
        `Company: ${lead.company}`,
        `POC: ${lead.poc}`,
        `From / Logged in user: ${user?.name || "Unknown"} (${user?.email || ""})`,
      ].join("\n")
    );
    const mailto = `mailto:${lead.email || ""}?subject=${subject}&body=${body}`;

    logAction({
      userId: user?.id || "system",
      userName: user?.name || "System",
      userRole: user?.role || "SYSTEM",
      action: "email_clicked",
      collection: "Leads",
      entityId: lead.id,
      details: `Initiated email to ${lead.company} POC`,
      metadata: {
        leadId: lead.id,
        company: lead.company,
        poc: lead.poc,
        leadEmail: lead.email,
        currentUserEmail: user?.email || "",
        ownerId: lead.leadOwner,
        ownerName: ownerUser?.name || lead.leadOwner,
      },
    });

    const anchor = document.createElement("a");
    anchor.href = mailto;
    anchor.click();
    closeAll();
  };

  const handleCall = (lead: Lead) => {
    if (!lead.phone) {
      showToast("No phone number available for this lead.");
      closeAll();
      return;
    }

    logAction({
      userId: user?.id || "system",
      userName: user?.name || "System",
      userRole: user?.role || "SYSTEM",
      action: "call_clicked",
      collection: "Leads",
      entityId: lead.id,
      details: `Initiated call to ${lead.company} POC`,
      metadata: {
        leadId: lead.id,
        company: lead.company,
        poc: lead.poc,
        ownerId: lead.leadOwner,
      },
    });

    const anchor = document.createElement("a");
    anchor.href = `tel:${lead.phone}`;
    anchor.click();
    closeAll();
  };

  const handleAddActivity = (lead: Lead) => {
    logAction({
      userId: user?.id || "system",
      userName: user?.name || "System",
      userRole: user?.role || "SYSTEM",
      action: "add_activity_opened",
      collection: "Leads",
      entityId: lead.id,
      details: `Opened add activity for ${lead.company}`,
      metadata: { leadId: lead.id, company: lead.company },
    });
    closeAll();
    onQuickAddActivity(lead.id);
  };

  const handleChangeOwner = async (lead: Lead, newOwnerId: string) => {
    const prevOwner = ownerDirectory.find((u) => u.id === lead.leadOwner);
    const newOwner = ownerDirectory.find((u) => u.id === newOwnerId);

    if (backendEnabled) {
      try {
        await salesCrmLeadsApi.reassignOwner(lead.id, newOwnerId);
      } catch (err: any) {
        showToast(err?.message || "Failed to change owner.");
        closeAll();
        return;
      }
    }

    logAction({
      userId: user?.id || "system",
      userName: user?.name || "System",
      userRole: user?.role || "SYSTEM",
      action: "owner_change",
      collection: "Leads",
      entityId: lead.id,
      details: `Changed owner of ${lead.company} from ${prevOwner?.name || lead.leadOwner} to ${newOwner?.name || newOwnerId}`,
      metadata: {
        leadId: lead.id,
        company: lead.company,
        previousOwnerId: lead.leadOwner,
        previousOwnerName: prevOwner?.name || lead.leadOwner,
        newOwnerId,
        newOwnerName: newOwner?.name || newOwnerId,
        changedByUserId: user?.id || "system",
        changedByUserName: user?.name || "System",
        changedByRole: user?.role || "SYSTEM",
      },
    });

    onUpdateLead({ ...lead, leadOwner: newOwnerId });
    showToast(`Owner changed to ${newOwner?.name || newOwnerId}`);
    closeAll();
  };

  const getOwnerDisplay = (ownerId: string) => {
    const owner = ownerDirectory.find((u) => u.id === ownerId);
    if (!owner) return <span>{ownerId}</span>;
    return (
      <div>
        <div className={styles["lead-font-medium"]}>{owner.name}</div>
        <div className={`${styles["lead-text-muted"]} ${styles["lead-text-sm"]}`}>
          {ROLE_LABELS[owner.role] || owner.role}
        </div>
      </div>
    );
  };

  const renderCellContent = (lead: Lead, col: ColumnConfig) => {
    const canViewContacts = isContactFieldVisible(
      userRole,
      lead.leadOwner,
      currentUserId
    );

    if (col.isCustom) {
      return lead.customFields && lead.customFields[col.id]
        ? lead.customFields[col.id]
        : "-";
    }

    switch (col.id) {
      case "leadOwner":
        return getOwnerDisplay(lead.leadOwner);
      case "company":
        return (
          <>
            {lead.company}
            {lead.tags && lead.tags.length > 0 && (
              <div className={styles["lead-tag-container"]}>
                {lead.tags.map((t) => (
                  <span
                    key={t}
                    className={`${ui["ui-badge"]} ui-badge-secondary ${styles["lead-tag"]} ${styles["lead-text-xs"]}`}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </>
        );
      case "poc":
        return (
          <>
            <span className={styles["lead-text-medium"]}>
              {canViewContacts ? lead.poc : "***"}
            </span>
            <div className={`${styles["lead-text-muted"]} ${styles["lead-text-sm"]}`}>
              {canViewContacts ? lead.designation : "***"}
            </div>
          </>
        );
      case "contact":
        return (
          <>
            <div className={styles["lead-text-primary"]}>
              {canViewContacts ? lead.email : "***"}
            </div>
            <div className={styles["lead-text-primary"]}>
              {canViewContacts ? lead.phone : "***"}
            </div>
          </>
        );
      case "stage":
        return (
          <span className={`${ui["ui-badge"]} ${getStageColor(lead.leadStage)}`}>
            {lead.leadStage}
          </span>
        );
      case "score":
        return lead.leadScore || "-";
      case "activity": {
        if (lead.activities && lead.activities.length > 0) {
          const latest = lead.activities.reduce((a, b) =>
            new Date(a.dateTime).getTime() > new Date(b.dateTime).getTime()
              ? a
              : b
          );
          return new Date(latest.dateTime).toLocaleString();
        }
        return lead.lastActivityDate
          ? new Date(lead.lastActivityDate).toLocaleDateString()
          : "-";
      }
      case "action": {
        return (
          <button
            className={`${ui["ui-btn"]} ui-btn-icon ${ui["ui-btn-sm"]} lead-action-trigger`}
            onClick={(e) => handleToggleMenu(e, lead.id)}
            title="Actions"
          >
            <MoreVertical size={16} />
          </button>
        );
      }
      default:
        return (
          (lead as unknown as Record<string, string>)[col.id] || "-"
        );
    }
  };

  const renderActionMenu = () => {
    if (!openMenuId) return null;
    const lead = leads.find(l => l.id === openMenuId);
    if (!lead) return null;

    const hasAccess = canActOnLead(lead.leadOwner);
    const isOwnerOpen = ownerChangeId === lead.id;

    if (isOwnerOpen) {
      return createPortal(
        <div className={`${styles["lead-action-popover"]} ${styles["lead-owner-picker"]}`} ref={ownerRef}>
          <div className={styles["lead-owner-picker-title"]}>Assign Owner</div>
          {ownerDirectory.map((u) => (
            <button
              key={u.id}
              className={`${styles["lead-action-item"]} ${u.id === lead.leadOwner ? styles["lead-action-item--active"] : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                if (u.id !== lead.leadOwner) {
                  handleChangeOwner(lead, u.id);
                }
              }}
              disabled={u.id === lead.leadOwner}
              title={u.id === lead.leadOwner ? "Current owner" : `Assign to ${u.name}`}
            >
              <span>{u.name}</span>
              <span className={`${styles["lead-text-muted"]} ${styles["lead-text-xs"]}`}>
                {ROLE_LABELS[u.role] || u.role}
              </span>
            </button>
          ))}
        </div>,
        document.body
      );
    }

    return createPortal(
      <div className={styles["lead-action-popover"]} ref={menuRef}>
        <button
          className={styles["lead-action-item"]}
          disabled={!hasAccess}
          onClick={(e) => {
            e.stopPropagation();
            if (hasAccess) handleEmail(lead);
          }}
          title={hasAccess ? "Send Email" : "You do not have access"}
        >
          <Mail size={14} />
          <span>Email</span>
        </button>
        <button
          className={styles["lead-action-item"]}
          disabled={!hasAccess}
          onClick={(e) => {
            e.stopPropagation();
            if (hasAccess) handleCall(lead);
          }}
          title={hasAccess ? "Call Lead" : "You do not have access"}
        >
          <Phone size={14} />
          <span>Call</span>
        </button>
        <button
          className={styles["lead-action-item"]}
          disabled={!hasAccess}
          onClick={(e) => {
            e.stopPropagation();
            if (hasAccess) handleAddActivity(lead);
          }}
          title={hasAccess ? "Add Activity" : "You do not have access"}
        >
          <PlusCircle size={14} />
          <span>Add Activity</span>
        </button>
        <button
          className={styles["lead-action-item"]}
          disabled={!hasAccess}
          onClick={(e) => {
            e.stopPropagation();
            if (hasAccess) {
              setOwnerChangeId(lead.id);
            }
          }}
          title={hasAccess ? "Change Owner" : "You do not have access"}
        >
          <UserCog size={14} />
          <span>Change Owner</span>
        </button>
      </div>,
      document.body
    );
  };

  return (
    <div className={`${styles["lead-table-container"]} ${ui["ui-card"]} ${styles["lead-overflow-x"]}`}>
      {toast && (
        <div className={styles["lead-inline-toast"]}>{toast}</div>
      )}
      <table className={`${ui["ui-table"]} ${styles["lead-table"]}`}>
        <thead>
          <tr>
            {canBulkManage && (
              <th className={`${styles["lead-w-40"]} ${styles["lead-text-center"]}`}>
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={onToggleSelectAll}
                  title="Select all"
                />
              </th>
            )}
            {visibleColumns.map((col) => (
              <th
                key={col.id}
                className={col.id === "action" ? styles["lead-actions-col"] : ""}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leads.length === 0 ? (
            <tr>
              <td
                colSpan={
                  visibleColumns.length + (canBulkManage ? 1 : 0)
                }
                className={`${styles["lead-table-empty"]} ${styles["lead-text-center"]}`}
              >
                No leads found matching the criteria.
              </td>
            </tr>
          ) : (
            leads.map((lead) => {
              const isSelected = selectedIds.includes(lead.id);

              return (
                <tr
                  key={lead.id}
                  className={`${styles["lead-table-row"]} ${isSelected ? "selected" : ""}`}
                >
                  {canBulkManage && (
                    <td
                      className={styles["lead-text-center"]}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(lead.id)}
                        title={`Select ${lead.company}`}
                      />
                    </td>
                  )}
                  {visibleColumns.map((col) => (
                    <td
                      key={col.id}
                      className={`${col.id === "action" ? styles["lead-actions-col"] : ""} ${["company", "poc"].includes(col.id) ? styles["wrap-cell"] : ""}`}
                      onClick={
                        col.id === "action"
                          ? (e) => e.stopPropagation()
                          : () => onSelectLead(lead.id)
                      }
                    >
                      {renderCellContent(lead, col)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {renderActionMenu()}
    </div>
  );
}
