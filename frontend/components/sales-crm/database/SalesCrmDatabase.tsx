"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { CollectionType, DatabaseRecord, getSchema } from "@/lib/sales-crm/database-schema";
import { MOCK_CLIENTS, MOCK_TRAINERS, MOCK_VENDORS, MOCK_SERVICES, MOCK_LEADS_MASTER } from "@/lib/sales-crm/database-data";
import { logAction, AuditCollection, useAuth, canAddRecord, canDeleteRecord, canImport, canEditRecord, Role } from "@apex/sales-crm-shared";


import DatabaseSection from "./DatabaseSection";
import DatabaseModal from "./DatabaseModal";
import ImportDataModal from "./ImportDataModal";
import styles from "@/styles/sales-crm/database.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

function DatabasePageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  // Local State
  const [clients, setClients] = useState<DatabaseRecord[]>(MOCK_CLIENTS);
  const [trainers, setTrainers] = useState<DatabaseRecord[]>(MOCK_TRAINERS);
  const [vendors, setVendors] = useState<DatabaseRecord[]>(MOCK_VENDORS);
  const [services, setServices] = useState<DatabaseRecord[]>(MOCK_SERVICES);
  const [leadsMaster, setLeadsMaster] = useState<DatabaseRecord[]>(MOCK_LEADS_MASTER);

  // Modal State
  const [modalCollection, setModalCollection] = useState<CollectionType | null>(null);
  const [modalRecord, setModalRecord] = useState<DatabaseRecord | null>(null);

  const [uiMessage, setUiMessage] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const [showImportModal, setShowImportModal] = useState(false);

  const userRole = (user?.role as Role | undefined) ?? Role.EMPLOYEE;
  const canArchive = canDeleteRecord(userRole);
  const canAdd = canAddRecord(userRole);
  const canImportRecords = canImport(userRole);

  const checkRowEditPermission = (record: DatabaseRecord) => {
    if (record.owner_id) {
      return canEditRecord(userRole, String(record.owner_id), user?.id || "");
    }
    return userRole === Role.SUPERADMIN || userRole === Role.ADMIN;
  };

  const datasetCards: Array<{
    name: CollectionType;
    code: string;
    description: string;
    records: DatabaseRecord[];
  }> = [
    {
      name: "Clients",
      code: "CL",
      description: "Account master",
      records: clients,
    },
    {
      name: "Leads Master",
      code: "LM",
      description: "Lead reference data",
      records: leadsMaster,
    },
    {
      name: "Vendors",
      code: "VN",
      description: "Partner directory",
      records: vendors,
    },
    {
      name: "Trainers",
      code: "TR",
      description: "Talent network",
      records: trainers,
    },
    {
      name: "Service Database",
      code: "SD",
      description: "Service catalog",
      records: services,
    },
  ];
  const [selectedDataset, setSelectedDataset] = useState<CollectionType>(() => {
    const sectionParam = searchParams.get("section");
    if (sectionParam) {
      if (sectionParam === "trainers") return "Trainers";
      if (sectionParam === "clients") return "Clients";
      if (sectionParam === "vendors") return "Vendors";
      if (sectionParam === "services") return "Service Database";
      if (sectionParam === "leads") return "Leads Master";
    }
    return "Clients";
  });

  // Handle URL parameters for deep links
  useEffect(() => {
    const sectionParam = searchParams.get("section");
    const actionParam = searchParams.get("action");

    if (actionParam === "add" && sectionParam) {
      setTimeout(() => {
        if (canAdd) {
          let matchedCollection: CollectionType | null = null;
          if (sectionParam === "trainers") matchedCollection = "Trainers";

          if (matchedCollection) {
            setModalCollection(matchedCollection);
            setModalRecord(null);
          }
        } else {
          setPermissionError("You do not have permission to add records.");
        }
      }, 0);

      const newParams = new URLSearchParams(searchParams.toString());
      newParams.delete("action");
      router.replace(`${pathname}${newParams.toString() ? "?" + newParams.toString() : ""}`);
    }
  }, [searchParams, router, pathname, canAdd]);

  useEffect(() => {
    const handleOpenImport = () => {
      if (canImportRecords) {
        setShowImportModal(true);
      } else {
        setPermissionError("You do not have permission to import records.");
      }
    };

    window.addEventListener("salescrm:open-database-import", handleOpenImport);
    return () => {
      window.removeEventListener("salescrm:open-database-import", handleOpenImport);
    };
  }, [canImportRecords]);

  // Handlers
  const handleAdd = (collection: CollectionType) => {
    if (!canAdd) {
      setPermissionError("You do not have permission to add records.");
      return;
    }
    setModalCollection(collection);
    setModalRecord(null);
  };

  const handleUpdate = (collection: CollectionType, record: DatabaseRecord) => {
    const hasEditAccess = checkRowEditPermission(record);

    if (!hasEditAccess) {
      setPermissionError("You do not have permission to edit this record.");
      return;
    }
    setModalCollection(collection);
    setModalRecord(record);
  };

  const handleArchive = (collection: CollectionType, recordId: string) => {
    if (!canArchive) {
      setPermissionError("You do not have permission to archive records.");
      return;
    }
    updateCollection(collection, { id: recordId, status: "Archived", archived: "Yes" }, true);
    logAction({
      userId: user?.id || "system",
      userName: user ? user.name : "System",
      userRole: userRole,
      action: "archive",
      collection: `Database ${collection}` as AuditCollection,
      entityId: recordId,
      details: `Archived record in ${collection}`,
    });
  };

  const handleSaveModal = (record: DatabaseRecord) => {
    if (modalCollection) {
      const isUpdate = !!modalRecord;
      const finalRecord = { ...record };
      const schema = getSchema(modalCollection);
      const supportsOwner = schema.some((f) => f.name === "owner_id");
      if (supportsOwner) {
        const isSA = userRole === Role.SUPERADMIN || userRole === Role.ADMIN;
        if (!finalRecord.id || !modalRecord) {
          finalRecord.owner_id = user?.id || "";
        } else if (!isSA && modalRecord.owner_id) {
          finalRecord.owner_id = modalRecord.owner_id;
        }
      }
      updateCollection(modalCollection, finalRecord, false);

      logAction({
        userId: user?.id || "system",
        userName: user ? user.name : "System",
        userRole: userRole,
        action: isUpdate ? "update" : "create",
        collection: `Database ${modalCollection}` as AuditCollection,
        entityId: record.id,
        details: `${isUpdate ? "Updated" : "Added"} record in ${modalCollection}`,
        after: finalRecord,
      });
      setModalCollection(null);
      setModalRecord(null);
    }
  };

  const updateCollection = (collection: CollectionType, record: DatabaseRecord, partial: boolean) => {
    const updateList = (prevList: DatabaseRecord[]) => {
      const exists = prevList.some((r) => r.id === record.id);
      if (exists) {
        return prevList.map((r) => (r.id === record.id ? (partial ? { ...r, ...record } : record) : r));
      }
      return [record, ...prevList];
    };

    switch (collection) {
      case "Clients":
        setClients((prev) => updateList(prev));
        break;
      case "Trainers":
        setTrainers((prev) => updateList(prev));
        break;
      case "Vendors":
        setVendors((prev) => updateList(prev));
        break;
      case "Service Database":
        setServices((prev) => updateList(prev));
        break;
      case "Leads Master":
        setLeadsMaster((prev) => updateList(prev));
        break;
    }
  };

  const handleImportSuccess = (collection: CollectionType, validRows: DatabaseRecord[]) => {
    const schema = getSchema(collection);
    const supportsOwner = schema.some((f) => f.name === "owner_id");
    const finalRows = supportsOwner ? validRows.map((r) => ({ ...r, owner_id: user?.id || "" })) : validRows;

    const appendList = (prevList: DatabaseRecord[]) => [...finalRows, ...prevList];

    switch (collection) {
      case "Clients":
        setClients((prev) => appendList(prev));
        break;
      case "Trainers":
        setTrainers((prev) => appendList(prev));
        break;
      case "Vendors":
        setVendors((prev) => appendList(prev));
        break;
      case "Service Database":
        setServices((prev) => appendList(prev));
        break;
      case "Leads Master":
        setLeadsMaster((prev) => appendList(prev));
        break;
    }

    logAction({
      userId: user?.id || "system",
      userName: user ? user.name : "System",
      userRole: userRole,
      action: "import",
      collection: `Database ${collection}` as AuditCollection,
      details: `Imported ${validRows.length} records into ${collection}`,
    });
  };

  return (
    <div className={styles["db-page-container"]}>
      <div className={styles["db-page-header"]}>
        <div>
          <span className={`${ui["ui-badge"]} ${ui["ui-badge-primary"]}`}>Data Hub</span>
          <h1 className={styles["db-page-title"]}>Master Database</h1>
        </div>
        <div className={styles["db-header-actions"]}>
          {canImportRecords && (
            <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={() => setShowImportModal(true)}>
              Import Data
            </button>
          )}
        </div>
      </div>
      <div className={styles["db-switcher-container"]}>
        <div className={styles["db-switcher"]}>
          {datasetCards.map((item) => (
            <button
              key={item.name}
              className={`${styles["db-switch-button"]} ${selectedDataset === item.name ? styles["db-switch-button-active"] : ""}`}
              onClick={() => setSelectedDataset(item.name)}
            >
              <span className={styles["db-switch-code"]}>{item.code}</span>
              <span className={styles["db-switch-copy"]}>
                <span className={styles["db-switch-label"]}>{item.name}</span>
                <span className={styles["db-switch-meta"]}>{item.description}</span>
              </span>
              <span className={styles["db-switch-count"]}>{item.records.length}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Sections */}
      {selectedDataset === "Clients" && (
        <DatabaseSection
          title="Clients"
          records={clients}
          canAdd={canAdd}
          canEditRecord={checkRowEditPermission}
          canArchive={canArchive}
          onAdd={handleAdd}
          onUpdate={handleUpdate}
          onArchive={handleArchive}
        />
      )}

      {selectedDataset === "Leads Master" && (
        <DatabaseSection
          title="Leads Master"
          records={leadsMaster}
          canAdd={canAdd}
          canEditRecord={checkRowEditPermission}
          canArchive={canArchive}
          onAdd={handleAdd}
          onUpdate={handleUpdate}
          onArchive={handleArchive}
        />
      )}

      {selectedDataset === "Vendors" && (
        <DatabaseSection
          title="Vendors"
          records={vendors}
          canAdd={canAdd}
          canEditRecord={checkRowEditPermission}
          canArchive={canArchive}
          onAdd={handleAdd}
          onUpdate={handleUpdate}
          onArchive={handleArchive}
        />
      )}

      {selectedDataset === "Trainers" && (
        <DatabaseSection
          title="Trainers"
          records={trainers}
          canAdd={canAdd}
          canEditRecord={checkRowEditPermission}
          canArchive={canArchive}
          onAdd={handleAdd}
          onUpdate={handleUpdate}
          onArchive={handleArchive}
        />
      )}

      {selectedDataset === "Service Database" && (
        <DatabaseSection
          title="Service Database"
          records={services}
          canAdd={canAdd}
          canEditRecord={checkRowEditPermission}
          canArchive={canArchive}
          onAdd={handleAdd}
          onUpdate={handleUpdate}
          onArchive={handleArchive}
        />
      )}

      {/* Modals */}
      {modalCollection && (
        <DatabaseModal
          collection={modalCollection}
          record={modalRecord}
          onClose={() => {
            setModalCollection(null);
            setModalRecord(null);
          }}
          onSave={handleSaveModal}
        />
      )}

      {showImportModal && <ImportDataModal onClose={() => setShowImportModal(false)} onImport={handleImportSuccess} />}

      {uiMessage && (
        <div className={ui["ui-modal-overlay"]}>
          <div className={`${ui["ui-modal"]} ${styles["db-modal-sm"]} ${styles["db-modal-center"]}`}>
            <h3 className={ui["ui-modal-header"]}>Notice</h3>
            <div className={ui["ui-modal-body"]}>
              <p>{uiMessage}</p>
            </div>
            <div className={ui["ui-modal-footer"]}>
              <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={() => setUiMessage(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {permissionError && (
        <div className={ui["ui-modal-overlay"]}>
          <div className={`${ui["ui-modal"]} ${styles["db-modal-sm"]} ${styles["db-modal-center"]}`}>
            <div className={ui["ui-modal-body"]}>
              <div className={`${ui["ui-notice"]} ${ui["ui-notice-error"]} ${styles["db-summary-stack"]}`}>{permissionError}</div>
            </div>
            <div className={ui["ui-modal-footer"]}>
              <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={() => setPermissionError(null)}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SalesCrmDatabase() {
  return (
    <Suspense fallback={<div>Loading Database...</div>}>
      <DatabasePageContent />
    </Suspense>
  );
}
